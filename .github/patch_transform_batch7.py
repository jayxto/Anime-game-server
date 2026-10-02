from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
start=s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end=s.find('\n];',start)
if start<0 or end<0: raise SystemExit('verified source array not found')
marker='QAP_VERIFIED_TRANSFORM_BATCH7'
if marker not in s[start:end]:
    body=s[start:end]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // QAP_VERIFIED_TRANSFORM_BATCH7 — visually reviewed distinctive forms.
    { needs:['denji','chainsaw devil'], url:'https://cdn.cgmagonline.com/wp-content/uploads/2025/08/chainsaw-manthe-movie-reze-arc-coming-out-october-29-in-north-america-2025-08-30-740203-1536x864.jpg' },
    { needs:['pochita','hero of hell'], url:'https://pbs.twimg.com/media/G6SDDOeXcAA_cIr.jpg' },
    { needs:['garou','awakened'], url:'https://i.pinimg.com/736x/5e/96/e9/5e96e95cf353880d43166d6f5e22db35.jpg' },
    { needs:['kaneki','kakuja'], url:'https://pbs.twimg.com/media/EaE24AnU4AAvwLR.jpg' },
    { needs:['alucard','level zero'], url:'https://i.pinimg.com/originals/e3/d3/b9/e3d3b9112905d439904bd640c7936161.jpg' },
    { needs:['shinji','eva-01 awakened'], url:'https://forum.evanotend.com/uploads/monthly_2018_06/Eva2-22_C1756.jpg.d3a17260b9130e49674577dbfa505ee5.jpg' },
    { needs:['rin','blue flames'], url:'https://i.pinimg.com/736x/95/00/ac/9500ac0a6049f35f0723bbc20c8c64a8.jpg' },
    { needs:['asura','kishin'], url:'https://vignette.wikia.nocookie.net/souleater/images/5/5b/Episode_50_-_Asura_recreated_third_form.png/revision/latest?cb=20191007130646' },
    { needs:['inuyasha','full demon'], url:'https://vignette.wikia.nocookie.net/inuyasha/images/a/ad/The_Demon%27s_True_Nature.png/revision/latest?cb=20190215234638' },
    { needs:['vash','angel arm'], url:'https://m.media-amazon.com/images/M/MV5BNjcwMzM3YzQtNzFiZS00YzVlLWFlOGMtYTllM2VjOTNjYTZmXkEyXkFqcGc%40._V1_.jpg' },
    { needs:['ainz','perfect warrior'], url:'https://i.imgur.com/vsXb2KG.png' },
    { needs:['sakura','dark sakura'], url:'https://occ-0-8407-2219.1.nflxso.net/dnm/api/v6/6AYY37jfdO6hpXcMjf9Yu5cnmO0/AAAABVN6dDaO-MpX2Qdneytzsxs77uzLmR3Yo-H9d98Xidi3AgAFwmBsOwXyV2-o5sPh9SkQlI-e5y5Sg_KMnDoW7EUqcb4vI14AFWc4.jpg?r=168' }'''
    s=s[:end]+rows+s[end:]
p.write_text(s,encoding='utf-8')
print('batch7:', marker in s)
