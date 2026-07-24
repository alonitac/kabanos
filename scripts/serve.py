#!/usr/bin/env python3
"""
Development server for Kabanos rehearsal app.

Serves static files from the repo root AND provides a /api/save-line endpoint
so the edit mode (?edit=1) can write timestamp corrections back to the JSON files.

Usage:
    python3 scripts/serve.py          # port 8080
    python3 scripts/serve.py 9000     # custom port

Then open:
    http://localhost:8080/            # normal mode
    http://localhost:8080/?edit=1     # edit mode — shows timestamp editor
"""

import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VALID_SCENES = {'12', '15', '16', '17', '18'}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO, **kwargs)

    # ── POST /api/save-line ────────────────────────────────────────────────
    def do_POST(self):
        if self.path == '/api/save-line':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length)
                payload = json.loads(body)

                scene = str(payload['scene'])
                line_id = int(payload['id'])
                start = round(float(payload['start']), 2)
                end = round(float(payload['end']), 2)

                if scene not in VALID_SCENES:
                    self._respond(400, f'Invalid scene: {scene}')
                    return
                if start < 0 or end <= start:
                    self._respond(400, f'Invalid range: {start}-{end}')
                    return

                out_path = os.path.join(REPO, 'data', f'scene-{scene}.json')
                with open(out_path, encoding='utf-8') as f:
                    data = json.load(f)

                updated = False
                for line in data['lines']:
                    if line['id'] == line_id:
                        line['start'] = start
                        line['end'] = end
                        line.pop('interpolated', None)  # clear flag on manual fix
                        updated = True
                        break

                if not updated:
                    self._respond(404, f'Line {line_id} not found in scene {scene}')
                    return

                with open(out_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)

                print(f'  [edit] scene {scene} line {line_id}: {start}–{end}')
                self._respond(200, 'saved')

            except (KeyError, ValueError, json.JSONDecodeError) as e:
                self._respond(400, f'Bad request: {e}')
            except OSError as e:
                self._respond(500, f'File error: {e}')
        else:
            self._respond(404, 'Not found')

    def _respond(self, code: int, msg: str) -> None:
        body = msg.encode()
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # silence default per-request noise; edits are printed above


if __name__ == '__main__':
    os.chdir(REPO)
    httpd = HTTPServer(('localhost', PORT), Handler)
    print(f'Kabanos dev server → http://localhost:{PORT}/')
    print(f'Edit mode          → http://localhost:{PORT}/?edit=1')
    print('Ctrl-C to stop.\n')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
