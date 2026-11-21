#!/usr/bin/env python3
"""A local stand-in for the parts of the Cloudflare API that `claudeweb domain`
uses, for packaging/test-domain.sh. State is kept in memory and dumped to
STATE_FILE after every request so the test can inspect it.

usage: test-domain-mock.py <port> <state file> <api token> <domain> <zone id> <account id>
Touching <state file>.fail-token makes the next tunnel-token request fail once.
"""
import json
import os
import re
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT, STATE_FILE, TOKEN, DOMAIN, ZONE, ACCOUNT = sys.argv[1:7]
PREFIX = '/client/v4'
state = {'dns': {}, 'tunnels': {}, 'configs': {}, 'requests': []}


def save():
    with open(STATE_FILE + '.tmp', 'w') as stream:
        json.dump(state, stream, indent=1)
    os.replace(STATE_FILE + '.tmp', STATE_FILE)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, result=None, code=200, error=None):
        body = {'success': error is None, 'errors': [] if error is None else [{'code': code, 'message': error}],
                'messages': [], 'result': result}
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_any(self, method):
        url = urlparse(self.path)
        path, query = url.path, parse_qs(url.query)
        length = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(length) or b'null') if length else None
        state['requests'].append(f'{method} {path}')
        try:
            if self.headers.get('Authorization') != 'Bearer ' + TOKEN:
                return self.reply(code=403, error='Authentication error')
            if not path.startswith(PREFIX):
                return self.reply(code=404, error='no route')
            path = path[len(PREFIX):]
            zone = '/zones/' + ZONE
            tunnels = '/accounts/' + ACCOUNT + '/cfd_tunnel'
            if method == 'GET' and path == zone:
                return self.reply({'id': ZONE, 'name': DOMAIN, 'status': 'active'})
            if path.startswith('/zones/') and not path.startswith(zone):
                return self.reply(code=404, error='zone not found')
            if path == zone + '/dns_records' and method == 'GET':
                name = query.get('name', [None])[0]
                return self.reply([r for r in state['dns'].values() if name is None or r['name'] == name])
            if path == zone + '/dns_records' and method == 'POST':
                record = dict(body, id=uuid.uuid4().hex)
                state['dns'][record['id']] = record
                return self.reply(record)
            match = re.fullmatch(re.escape(zone) + r'/dns_records/([0-9a-f]+)', path)
            if match and method == 'DELETE':
                state['dns'].pop(match.group(1))
                return self.reply({'id': match.group(1)})
            if path == tunnels and method == 'GET':
                name = query.get('name', [None])[0]
                return self.reply([t for t in state['tunnels'].values() if name is None or t['name'] == name])
            if path == tunnels and method == 'POST':
                tunnel = {'id': str(uuid.uuid4()), 'name': body['name'], 'config_src': body.get('config_src')}
                state['tunnels'][tunnel['id']] = tunnel
                return self.reply(tunnel)
            match = re.fullmatch(re.escape(tunnels) + r'/([0-9a-f-]{36})(/[a-z]+)?', path)
            if match and match.group(1) in state['tunnels']:
                ident, tail = match.group(1), match.group(2) or ''
                if tail == '' and method == 'GET':
                    return self.reply(state['tunnels'][ident])
                if tail == '' and method == 'DELETE':
                    state['configs'].pop(ident, None)
                    return self.reply(state['tunnels'].pop(ident))
                if tail == '/connections' and method == 'DELETE':
                    return self.reply(None)
                if tail == '/configurations' and method == 'PUT':
                    state['configs'][ident] = body
                    return self.reply(body)
                if tail == '/token' and method == 'GET':
                    if os.path.exists(STATE_FILE + '.fail-token'):
                        os.remove(STATE_FILE + '.fail-token')
                        return self.reply(code=500, error='temporary failure')
                    return self.reply('run-token-for-' + ident)
            return self.reply(code=404, error='no route')
        finally:
            save()

    def do_GET(self): self.handle_any('GET')
    def do_POST(self): self.handle_any('POST')
    def do_PUT(self): self.handle_any('PUT')
    def do_DELETE(self): self.handle_any('DELETE')


save()
ThreadingHTTPServer(('127.0.0.1', int(PORT)), Handler).serve_forever()
