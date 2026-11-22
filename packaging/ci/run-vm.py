"""CI only: run one packaging test in a fresh supported VM and throw it away.

usage: python3 packaging/ci/run-vm.py --os debian-12|ubuntu-22.04 --test install|update|browser|devices|sudo --releases DIR --out DIR
       python3 packaging/ci/run-vm.py --test public --version X.Y.Z --out DIR   (a published release, from the internet)

The GitHub runner boots a pinned Debian/Ubuntu cloud image (digest checked
against the publisher's checksum file) under QEMU, 2 vCPUs and 4 GiB, logs
in with a key made for this run, copies install.sh (the copy that trusts the
run's test key), packaging/ and the test packages to /root/cw, runs the test as
root and copies its logs back. The exit code is the test's.
"""
import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
IMAGES = {
    'debian-12': {
        'base': 'https://cloudfront.debian.net/cdimage/cloud/bookworm/20261018-2635/',
        'name': 'debian-12-genericcloud-amd64-20261018-2635.qcow2',
        'algorithm': 'sha512',
        'digest': 'dc0d7b526a3a9a9265142fe8e903984c03f8d605ac4ba6f14d15d27988a69581fb05fc06cd2a6d79f6eaf68ba9725f2eb38b5ddd64ad166faadad279af776c9e',
    },
    'ubuntu-22.04': {
        'base': 'https://cloud-images.ubuntu.com/minimal/releases/jammy/release-20261113/',
        'name': 'ubuntu-22.04-minimal-cloudimg-amd64.img',
        'algorithm': 'sha256',
        'digest': 'dac74360a7d0fa6b848d08134e31c0da0615467ffd712575aae65c825882411b',
    },
}
PORT = 22322
TESTS = {
    'install': ('test-install.sh', 'releases/claudeweb-2.0.0-linux-x64.tar.xz', ['claudeweb-2.0.0-linux-x64.tar.xz']),
    'browser': ('test-browser.sh', 'releases/claudeweb-2.0.0-linux-x64.tar.xz', ['claudeweb-2.0.0-linux-x64.tar.xz']),
    'devices': ('test-devices.sh', 'releases/claudeweb-2.0.0-linux-x64.tar.xz', ['claudeweb-2.0.0-linux-x64.tar.xz']),
    'sudo': ('test-sudo.sh', 'releases/claudeweb-2.0.0-linux-x64.tar.xz', ['claudeweb-2.0.0-linux-x64.tar.xz']),
    'update': ('test-update.sh', 'releases', None),
    # A published release: the VM fetches everything itself, nothing is copied but the test.
    'public': ('test-public-install.sh', None, []),
}


def run(args, **kwargs):
    kwargs.setdefault('timeout', 600)
    return subprocess.run(args, check=True, **kwargs)


def checksum(path, algorithm):
    digest = hashlib.new(algorithm)
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def base_image(cache, platform):
    spec = IMAGES[platform]
    cache = cache / platform
    cache.mkdir(parents=True, exist_ok=True)
    image = cache / spec['name']
    if not image.exists() or checksum(image, spec['algorithm']) != spec['digest']:
        sums_name = spec['algorithm'].upper() + 'SUMS'
        sums = cache / sums_name
        run(['curl', '-fsSL', '--retry', '3', '-o', str(sums), spec['base'] + sums_name])
        published = next(line.split()[0] for line in sums.read_text().splitlines() if line.split()[-1].lstrip('*') == spec['name'])
        if published != spec['digest']:
            raise SystemExit('Publisher has another checksum for the pinned image')
        run(['curl', '-fsSL', '--retry', '3', '-o', str(image), spec['base'] + spec['name']], timeout=900)
        if checksum(image, spec['algorithm']) != spec['digest']:
            raise SystemExit('Downloaded image does not match its checksum')
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--os', choices=sorted(IMAGES), default='debian-12')
    parser.add_argument('--test', choices=sorted(TESTS), required=True)
    parser.add_argument('--releases', type=Path)
    parser.add_argument('--version')
    parser.add_argument('--from', dest='from_version', help='public test: install this published release first, then update')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=Path.home() / '.cache/claudeweb-ci')
    options = parser.parse_args()
    script, argument, packages = TESTS[options.test]
    public = options.test == 'public'
    if public and not re.fullmatch(r'\d{1,4}\.\d{1,4}\.\d{1,4}', options.version or ''):
        raise SystemExit('--version=X.Y.Z is required for the public test')
    if options.from_version and not (public and re.fullmatch(r'\d{1,4}\.\d{1,4}\.\d{1,4}', options.from_version)):
        raise SystemExit('--from=X.Y.Z is only for the public test')
    if not public and not options.releases:
        raise SystemExit('--releases is required')
    out = options.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    image = base_image(options.cache, options.os)

    with tempfile.TemporaryDirectory(prefix='claudeweb-vm-') as temp:
        work = Path(temp)
        for name in ('admin', 'host'):
            run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(work / name)])
        user_data = '\n'.join([
            '#cloud-config',
            'users:',
            '  - name: ciadmin',
            '    groups: [sudo]',
            "    sudo: 'ALL=(ALL) NOPASSWD:ALL'",
            '    shell: /bin/bash',
            '    lock_passwd: true',
            '    ssh_authorized_keys: [' + repr((work / 'admin.pub').read_text().strip()) + ']',
            'ssh_pwauth: false',
            'disable_root: true',
            'ssh_keys:',
            '  ed25519_private: |',
            *['    ' + line for line in (work / 'host').read_text().splitlines()],
            '  ed25519_public: ' + (work / 'host.pub').read_text().strip(),
            'runcmd:',
            '  - [touch, /var/tmp/claudeweb-ci-ready]',
            '',
        ])
        (work / 'user-data').write_text(user_data)
        (work / 'meta-data').write_text('instance-id: claudeweb-ci\nlocal-hostname: claudeweb-ci\n')
        (work / 'known_hosts').write_text(f'[127.0.0.1]:{PORT} ' + (work / 'host.pub').read_text())
        run(['genisoimage', '-quiet', '-output', str(work / 'seed.iso'), '-volid', 'cidata', '-joliet', '-rock', str(work / 'user-data'), str(work / 'meta-data')])
        run(['qemu-img', 'create', '-q', '-f', 'qcow2', '-F', 'qcow2', '-b', str(image), str(work / 'disk.qcow2'), '20G'])

        # What the test runs, laid out as the repository: /root/cw/install.sh, packaging/, releases/.
        bundle = work / 'bundle.tar'
        with tarfile.open(bundle, 'w') as tar:
            tar.add(ROOT / 'packaging', 'cw/packaging', filter=lambda item: None if '/ci' in item.name else item)
            if not public:
                tar.add(options.releases / 'install.sh', 'cw/install.sh')
                for item in sorted(options.releases.iterdir()):
                    if packages is None or item.name in packages or item.name in [p + '.sha256' for p in packages]:
                        tar.add(item, 'cw/releases/' + item.name)

        acceleration = ['-accel', 'kvm', '-cpu', 'host'] if os.access('/dev/kvm', os.R_OK | os.W_OK) else ['-accel', 'tcg', '-cpu', 'max']
        serial = (out / 'serial.log').open('wb')
        vm = subprocess.Popen(['qemu-system-x86_64', *acceleration, '-m', '4096', '-smp', '2', '-display', 'none', '-serial', 'stdio', '-nodefaults',
                               '-drive', f'file={work / "disk.qcow2"},if=virtio', '-drive', f'file={work / "seed.iso"},media=cdrom,readonly=on',
                               '-netdev', f'user,id=n0,hostfwd=tcp:127.0.0.1:{PORT}-:22', '-device', 'virtio-net-pci,netdev=n0'],
                              stdout=serial, stderr=subprocess.STDOUT)
        ssh = ['ssh', '-i', str(work / 'admin'), '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={work / "known_hosts"}',
               '-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', '-p', str(PORT), 'ciadmin@127.0.0.1']
        status = 1
        try:
            deadline = time.monotonic() + 300
            while True:
                if vm.poll() is not None:
                    raise SystemExit('The VM stopped while booting; see serial.log')
                probe = subprocess.run(ssh + ['test -f /var/tmp/claudeweb-ci-ready'], capture_output=True, timeout=30)
                if probe.returncode == 0:
                    break
                if time.monotonic() > deadline:
                    raise SystemExit('The VM did not accept SSH within 5 minutes; see serial.log')
                time.sleep(3)
            print('VM ready; copying the test files', flush=True)
            with bundle.open('rb') as stream:
                run(ssh + ['sudo tar -x --no-same-owner -C /root'], stdin=stream, timeout=900)
            print(f'== {script}', flush=True)
            with (out / 'test.log').open('wb') as log:
                target = ' '.join(filter(None, [options.version, options.from_version])) if public else f'/root/cw/{argument}'
                test = subprocess.Popen(ssh + [f'sudo bash -c "cd /root/cw && bash packaging/{script} {target}"'],
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                for line in test.stdout:
                    sys.stdout.buffer.write(line)
                    sys.stdout.flush()
                    log.write(line)
                status = test.wait(timeout=3600)
            print(f'test exit {status}', flush=True)
        finally:
            try:
                with (out / 'vm-logs.tar').open('wb') as logs:
                    subprocess.run(ssh + ["sudo sh -c 'journalctl -b --no-pager > /tmp/cw-journal.out 2>&1; cd /tmp && tar -cf - cw-*.out'"],
                                   stdout=logs, timeout=120)
            except Exception as error:
                print('could not copy the VM logs:', error, flush=True)
            vm.terminate()
            try:
                vm.wait(timeout=60)
            except subprocess.TimeoutExpired:
                vm.kill()
            serial.close()
    sys.exit(status)


if __name__ == '__main__':
    main()
