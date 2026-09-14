"""通过真实 HTTP 按实际字幕时长验收正式章节；只应指向独立测试服务。"""
import argparse
import json
import time
from urllib.request import Request, urlopen
from uuid import uuid4


def run(base_url):
    def call(path, body=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        request = Request(base_url.rstrip('/') + path, headers=headers,
                          data=json.dumps(body).encode() if body is not None else None)
        with urlopen(request, timeout=15) as response:
            return json.load(response)

    assert call('/api/story')['flow'] == 'screening'
    created = call('/api/sessions', {})
    token, state = created['token'], created['state']
    def write(path, **fields):
        nonlocal state
        body = {'request_id': str(uuid4()), 'expected_version': state['version'], **fields}
        state = call(path, body, token)
        assert call(path, body, token) == state, '重复请求必须返回同一结果'

    write('/api/screening/start', confirm=True)
    count = 0
    while state['phase'] == 'screening':
        view = call('/api/screening', token=token)
        # Reload recovery replays the incomplete unit and issues a new run_id.
        if count == 1:
            assert call('/api/session', token=token) == state
            write('/api/screening/resume', run_id=state['playback']['run_id'])
            view = call('/api/screening', token=token)
        time.sleep(view['segment']['duration_ms'] / 1000 + 0.02)
        write('/api/screening/progress', run_id=state['playback']['run_id'], segment_id=view['segment']['id'])
        count += 1
    assert state['phase'] == 'after_screening' and state['can_collect']
    write('/api/collection', confirm=True)
    saved = call('/api/collection', token=token)
    assert saved['owner'] == '苏晚' and saved['custodian'] == '看山'
    assert len(saved['full_text']) == count == 51
    assert call('/api/session', token=token) == state
    write('/api/reset', confirm=True)
    assert state['phase'] == 'before_screening' and state['playback'] is None
    assert state['collection'] is None
    print(json.dumps({'result':'passed', 'segments':count, 'version':state['version'],
                      'restored_and_reset':True, 'original_verified':saved['source']['original_verified']},
                     ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:8000')
    run(parser.parse_args().base_url)
