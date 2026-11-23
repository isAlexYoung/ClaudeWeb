/** Used only by the CMCP bridge service to install its connector as this service's account. */
export const cmcpBootstrap = String.raw`
import contextlib, importlib.util, json, os, stat, sys, time
from pathlib import Path

if sys.version_info < (3, 9):
    raise ValueError('Python 3.9 or newer is required')
raw = sys.stdin.buffer.readline(1536 * 1024 + 1)
if len(raw) > 1536 * 1024 or not raw.endswith(b'\n'):
    raise ValueError('Invalid CMCP bootstrap')
data = json.loads(raw)
name = data.get('name')
if name not in ('windows-pc-files', 'linux-pc-files', 'mac-pc-files'):
    raise ValueError('Invalid connector name')
if not isinstance(data.get('catalog'), dict) or not isinstance(data['catalog'].get('tools'), list):
    raise ValueError('Invalid tool catalog')
if os.environ.get('CLAUDE_CONFIG_DIR'):
    raise ValueError('Custom CLAUDE_CONFIG_DIR needs explicit configuration')
home = Path.home()
directory = home
for part in ('.local', 'share', 'cloudpc-link', name):
    directory = directory / part
    if directory.is_symlink():
        raise ValueError('Unsafe connector directory')
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
        raise ValueError('Unsafe connector directory')
private = directory
relay_dir = private / 'relay'
relay_dir.mkdir(mode=0o700, exist_ok=True)
if relay_dir.is_symlink() or relay_dir.stat().st_uid != os.getuid() or relay_dir.stat().st_mode & 0o077:
    raise ValueError('Unsafe relay directory')
os.environ.pop('CLOUDPC_CC_SHARED', None)
os.environ['CLOUDPC_LINK_SOCKET'] = str(relay_dir / 'link.sock')
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, str(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
for file, key in (('cloudpc-relay.py', 'relay'), ('source-connector.py', 'connector')):
    source = data.get(key)
    if not isinstance(source, str) or len(source.encode('utf-8')) > 512 * 1024:
        raise ValueError('Invalid connector source')
    target = private / file
    if target.exists() or target.is_symlink():
        info = target.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
            raise ValueError('Unsafe connector file')
    temporary = target.with_name(file + '.new-' + os.urandom(8).hex())
    try:
        fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            output.write(source)
        os.replace(str(temporary), str(target))
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()
connector = load('cmcp_connector', private / 'source-connector.py')
for attempt in range(5):
    try:
        with contextlib.redirect_stdout(sys.stderr):
            connector.apply_install(private, [home / '.claude.json'], data['catalog'], name)
        break
    except connector.ConfigRace:
        if attempt == 4:
            raise
        time.sleep(0.2)
load('cmcp_relay', private / 'cloudpc-relay.py').Relay(relay_dir).run()
`;
