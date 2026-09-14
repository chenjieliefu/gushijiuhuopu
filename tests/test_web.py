from fastapi.testclient import TestClient

from app.web import create_web_app


def test_cloud_entry_serves_game_and_api_without_exposing_private_files(tmp_path, monkeypatch):
    public = tmp_path / 'dist'
    public.mkdir()
    (public / 'index.html').write_text('<h1>故事旧货铺</h1>')
    (public / 'audio').mkdir()
    (public / 'audio/voice.mp3').write_bytes(b'ID3test')
    (tmp_path / '.env.ai').write_text('DO_NOT_EXPOSE')
    monkeypatch.setenv('FRONTEND_DIST', str(public))
    monkeypatch.setenv('AI_MODE', 'mock')
    monkeypatch.delenv('STORY_PATH', raising=False)
    with TestClient(create_web_app(database_path=tmp_path / 'game.sqlite3')) as client:
        assert '故事旧货铺' in client.get('/').text
        assert client.get('/health').json()['status'] == 'ok'
        assert client.post('/api/sessions').status_code == 201
        assert client.get('/api/session').status_code == 401
        assert client.get('/audio/voice.mp3').content == b'ID3test'
        assert 'max-age=3600' in client.get('/audio/voice.mp3').headers['cache-control']
        assert client.get('/api/session').headers['cache-control'] == 'no-store'
        for path in ('/.env.ai', '/%2e%2e/.env.ai', '/api/not-found', '/audio/missing.mp3'):
            response = client.get(path)
            assert response.status_code == 404
            assert 'DO_NOT_EXPOSE' not in response.text
            assert '<h1>' not in response.text
