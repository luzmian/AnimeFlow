"""Explicit external platform links. No stream URLs or playback scraping."""
import json
from pathlib import Path
from functools import lru_cache
@lru_cache(maxsize=1)
def dataset():return json.loads(Path(__file__).with_name('assets').joinpath('platform-links.json').read_text())
def links(subject_id):
    if not isinstance(subject_id,int) or subject_id<=0:raise ValueError('条目 ID 无效')
    d=dataset();entry=d['entries'].get(str(subject_id),{})
    return {'links':entry.get('links',[]),'source':d['source'],'retrieved':d['retrieved'],
            'notice':'登记的平台页面，可用性与授权期限未实时核验；打开平台页面不计为已观看。'}
