import http.client
import importlib.util
import os
import shutil
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch



class AdminAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        root = Path(cls.directory.name)
        source = Path(__file__).parent
        (root / 'quests.json').write_text('{"routes": []}')
        (root / 'activities.csv').write_text('Activity Date,Filename\n')
        shutil.copyfile(source / 'admin.html', root / 'admin.html')
        shutil.copytree(source / 'admin-ui/generated', root / 'admin-ui/generated')
        spec = importlib.util.spec_from_file_location('standalone_admin_assets_test', source / 'admin.py')
        cls.admin = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {
            'GODIESEL_CHECKOUT_ROOT': str(root),
            'GODIESEL_DIESEL_DIARIES_ROOT': str(root),
        }):
            spec.loader.exec_module(cls.admin)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), cls.admin.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.directory.cleanup()

    def get(self, path):
        connection = http.client.HTTPConnection(*self.server.server_address)
        try:
            connection.request('GET', path)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_page_and_module_load_without_a_node_process(self):
        with patch.object(self.admin.subprocess, 'Popen', side_effect=AssertionError('No runtime build')):
            for page in ('/', '/admin.html'):
                status, headers, body = self.get(page)
                self.assertEqual(status, 200)
                self.assertIn('text/html', headers['Content-Type'])
                self.assertIn(b'<script type="module">', body)
                self.assertIn(b'/admin-assets/presentation.js', body)
            status, headers, body = self.get('/admin-assets/presentation.js?v=1')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(body, (Path(__file__).parent / 'admin-ui/generated/presentation.js').read_bytes())
        self.assertIn(b'export function escapeHtml', body)

    def test_unlisted_assets_and_traversal_are_not_served(self):
        for path in (
            '/admin-assets/', '/admin-assets/presentation.ts',
            '/admin-assets/missing.js', '/admin-ui/generated/presentation.js',
            '/admin-assets/../quests.json', '/admin-assets/../../.env',
            '/admin-assets/%2e%2e/quests.json',
            '/admin-assets/presentation.js/../../quests.json',
            '/admin-assets/%70resentation.js', '/.env', '/quests.json',
        ):
            with self.subTest(path=path):
                status, _, body = self.get(path)
                self.assertEqual(status, 404)
                self.assertEqual(body, b'{"error": "not found"}')


if __name__ == '__main__':
    unittest.main()
