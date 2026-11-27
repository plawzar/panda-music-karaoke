"""Local PANDA MUSIC lyric screening. Word lists identify editorial cues only."""

from collections import Counter, defaultdict
from functools import lru_cache
import json
from pathlib import Path
import re
import unicodedata


def _pattern(expression):
    return re.compile(r"(?<!\w)(?:" + expression + r")(?!\w)", re.I)


# Curated common names from the controlled-substance list and editorial terms.
# Keep ordinary words, drug brand names and street names with other meanings below.
_EXPLICIT = _pattern(
    r"2c[-‑ ]?b|2с[-‑ ]?в|lsd[-‑ ]?25|лсд[-‑ ]?25|наркотик\w*|наркот[уаеой]+|наркоман\w*|кокаин\w*|крэк\w*|героин\w*|"
    r"амфетамин\w*|метамфетамин\w*|мефедрон\w*|метадон\w*|"
    r"марихуан\w*|каннабис\w*|гашиш\w*|анаш\w*|"
    r"псилоцибин\w*|псилоцин\w*|фентанил\w*|кетамин\w*|"
    r"морфин\w*|галлюциноген\w*|опиоид\w*|опиат\w*|экстази|мдма|лсд|тгк|"
    r"cocaine|crack cocaine|heroin|amphetamine|methamphetamine|mephedrone|"
    r"methadone|marijuana|cannabis|hashish|psilocybin|psilocin|"
    r"fentanyl|ketamine|morphine|opioids?|mdma|lsd|thc|"
    r"опиум\w*|опи[йяюе]\w*|дезоморфин\w*|диацетилморфин\w*|"
    r"гидрокодон\w*|гидроморфон\w*|оксикодон\w*|оксиморфон\w*|"
    r"бупренорфин\w*|кодеин\w*|трамадол\w*|альфентанил\w*|суфентанил\w*|ремифентанил\w*|"
    r"карфентанил\w*|дигидрокодеин\w*|гидроморфинол\w*|ацетилфентанил\w*|"
    r"левометадон\w*|леворфанол\w*|буторфанол\w*|пентазоцин\w*|петидин\w*|"
    r"этонитазен\w*|метонитазен\w*|изотонитазен\w*|мескалин\w*|"
    r"лисергид\w*|диметилтриптамин\w*|диэтилтриптамин\w*|дмт|"
    r"фенциклидин\w*|теноциклидин\w*|метоксетамин\w*|"
    r"меткатинон\w*|катинон\w*|метилон\w*|бутилон\w*|метедрон\w*|"
    r"мдпв|метилендиоксипировалерон\w*|пировалерон\w*|альфа[-‑ ]пвп|"
    r"тетрагидроканнабинол\w*|дронабинол\w*|набилон\w*|джей[-‑ ]дабл[-‑ ]ю[-‑ ]эйч|"
    r"дексамфетамин\w*|левамфетамин\w*|метилфенидат\w*|лиздексамфетамин\w*|"
    r"фенметразин\w*|фентермин\w*|метаквалон\w*|"
    r"тропакокаин\w*|экгонин\w*|глютетимид\w*|декстропропоксифен\w*|"
    r"пиритрамид\w*|альпразолам\w*|клоназепам\w*|диазепам\w*|"
    r"лоразепам\w*|флунитразепам\w*|фенобарбитал\w*|прегабалин\w*|"
    r"opium|desomorphine|hydrocodone|hydromorphone|oxycodone|oxymorphone|"
    r"buprenorphine|codeine|tramadol|sufentanil|carfentanil|remifentanil|"
    r"mescaline|dimethyltryptamine|dmt|phencyclidine|cathinone|"
    r"methylphenidate|lisdexamfetamine|methaqualone|dronabinol|"
    r"alprazolam|clonazepam|diazepam|lorazepam|flunitrazepam|pregabalin"
)
_FUZZY = (
    "кокаин", "героин", "амфетамин", "метамфетамин", "мефедрон", "метадон",
    "марихуана", "каннабис", "псилоцибин", "фентанил", "кетамин", "cocaine",
    "heroin", "amphetamine", "methamphetamine", "mephedrone", "marijuana",
    "cannabis", "psilocybin", "fentanyl", "ketamine",
    "оксикодон", "гидрокодон", "трамадол", "карфентанил", "альпразолам",
    "прегабалин", "мескалин", "меткатинон", "пировалерон", "дезоморфин",
    "псилоцин", "морфин", "кодеин", "метилфенидат", "hydrocodone", "oxycodone",
    "tramadol", "mescaline", "methadone", "alprazolam", "pregabalin",
)
_TABLETS = _pattern(r"таблет[а-яё]+|табл[аы]|пилюл[а-яё]+|кол[её]с(?:о|а|у|ом|е|ам|ами|ах)|"
    r"pills?|tablets?|wheels?")
_CANNABIS = _pattern(
    r"mary[\s-]+jane|мэри[\s-]+джейн|мэри[\s-]+джейн[а-яё]+|"
    r"трав[аыуеой]+|травк[аыуеиой]+|шишк[ауыиеой]+|косяк[а-яё]*|блант[а-яё]*|"
    r"weed|ganja|kush|sativa|indica|reefer|spliff|blunts?|joints?|skunk|pot|dope|gas|"
    r"хаш\w*|ганж\w*|к[уэ]ш\w*|сплифф?\w*|джойнт\w*|гандж\w*|"
    r"план\w*|дурь|шмаль|шишки|тгк[-‑ ]?вейп\w*|hash oil|sour diesel|purple haze|bc bud"
)
_PARTY = _pattern(r"молли|molly|xtc|[еэ]шк[а-яё]+|драг[аиуом]*|drugs?|"
    r"диско[-‑ ]?бисквит\w*|disco biscuits?|хтс|"
    r"ксанакс\w*|xanax|xans|занни|zanbars|zannies|перкоцет\w*|percocet|percs?|"
    r"оксиконтин\w*|oxycontin|oxys|addy|adderall|риталин\w*|ritalin|"
    r"рогипнол\w*|rohypnol|субутекс\w*|subutex|сабоксон\w*|suboxone")
_OTHER = _pattern(r"кокс[а-яё]*|соли?|фен[а-яё]*|герыч[а-яё]*|snow|speed|meth|smack|acid|"
    r"меф|амф|гаш|ск|клад\w*|кока|дурман|порошок|порох|"
    r"кристалл\w*|пудр\w*|снег\w*|п[её]сок|беляк\w*|льдышк\w*|"
    r"lean|purple drank|sizzurp|codeine syrup|crank|shabu|yaba|snowball|"
    r"blow|flake|coke|kief|dabs?|shatter|budder|honey oil")
_PERSON_ALIAS = _pattern(r"mary[\s-]+jane|мэри[\s-]+джейн|молли|molly")
_REVIEW_ALONE = _pattern(r"mary[\s-]+jane|мэри[\s-]+джейн|блант[а-яё]*|weed|ganja|kush|spliff|blunts?")
_TABLET_WORD = _pattern(r"таблет[а-яё]+|табл[аы]|пилюл[а-яё]+|pills?|tablets?")
_DEVICE = _pattern(r"планшет\w*|экран\w*|сенсор\w*|графическ\w*|ipad|android|touchscreen|stylus|digital|посудомоечн\w*|посудомой\w*|для бассейна|для растений|dishwasher|cleaning tablets")
_WHEEL_WORD = _pattern(r"кол[её]с(?:о|а|у|ом|е|ам|ами|ах)|wheels?")
_PARTY_CONTEXT = _pattern(r"на рейв\w*|на вписк\w*|на тус\w*|на танцпол\w*|на фестивал\w*|at a rave|at the club|on the dance floor")
_PROCURING = _pattern(r"мучу|мути\w*|замучу|замути\w*|доста(?:л\w*|ть)|заказал\w*|купил\w*|взял\w*|scor(?:e|ed)|buy|bought|got")
_SOBER_EFFECT = _pattern(r"от музыки|от (?:бита|баса|счастья|смеха|шутки|грусти|усталости|дождя)|дожд[её]м|ливнем|грустью|волной|от эмоций|передоз\w*\s+(?:работ\w*|информаци\w*|эмоци\w*|новост\w*)|from (?:the music|the beat|laughter)")
_USE = _pattern(r"закину\w*|закин[ье]\w*|съел\w*|ели|глота\w*|проглоти\w*|скуша\w*|пью|пь[её]м|разлил\w*|пролива\w*|сипа\w*|вкинул\w*|нюха\w*|вынюха\w*|занюха\w*|вмазал\w*|уколол\w*|употреб\w*|раскур\w*|курил\w*|курю|курим|торк\w*|упоро\w*|нюхнул\w*|затянул\w*|пыхнул\w*|popp?ed|popping|swallow\w*|snort\w*|smok\w*|shoot up|to get high")
_EFFECT = _pattern(r"торк\w*|упоро\w*|накры(?:л\w*|ва\w*)|вставило|трипанул\w*|передоз\w*|меня отпустило")
_TRAFFIC = _pattern(r"мучу|мутил\w*|замутил\w*|фасу\w*|расфасу\w*|сбыва\w*|сбыл\w*|варил\w*|купил\w*|закладк\w*|торгую|торговал\w*|deal\w*|sell\w*|sold")
_GUM_DRUG = _pattern(r"(?P<term>драг(?:а|и|у|ом)?)\s+(?:под|за)\s+д[её]сн[ауы]")
_GET_WHEELS = _pattern(r"(?:взять|брать|взял[аи]?|беру|берут|достать|достал[аи]?|мучу|мутить|купить|купил[аи]?)\s+(?:себе\s+)?(?P<term>кол[её]с(?:о|а))")
_SMOKE_OBJECT = _pattern(
    r"(?P<before>курю|курил[аи]?|курим|курят|курить)\s+(?:(?:это|такое|это самое)\s+)?г[оа]вно(?![-‑]\w)"
    r"|г[оа]вно\s+(?:(?:я|мы|снова|опять|теперь)\s+){0,2}(?P<after>курю|курил[аи]?|курим|курят|курить)"
)
_XAN_SHORT = _pattern(r"xan(?:s|ny|nies|['’][ауы])?|ксан[ауы]?|заны|зэны")
_XAN_INGESTION = _pattern(r"(?P<action>ел[аи]?|сожрал[аи]?)\s*$")
_XAN_QUANTITY = _pattern(r"(?:один|два|три|четыре|[1-4])\s*$")
_LEAN_ALIAS = _pattern(r"lean|лин(?:а|ом|е|ы|ами)?|сироп[ауеы]?")
_NAMED_LEAN = _pattern(r"lean|лин(?:а|ом|е|ы|ами)?|purple drank|sizzurp")
_SWEET_SYRUP = _pattern(r"кленов\w*|кл[её]нов\w*|сахарн\w*|ягодн\w*|коктейль\w*|блин\w*|maple|pancakes?|понч\w*|ванильн\w*")
_MJ_SHORT = _pattern(r"mj|m\.j\.?|эм[-‑ ]?джей")
_MOLLY_STATE = _pattern(r"под\s+(?P<term>molly|молли|моллей)")
_SNOW_STYLE = _pattern(r"шнег(?:а|ом|у)?")
_LIQUID_USE = _pattern(r"пью|пь[её]м|пил\w*|глот\w*|нали\w*|разлил\w*|пролива\w*|сипа\w*|в\s+(?:(?:мо[её]м|этом|сво[её]м)\s+)?стакан\w*|стакон\w*|двойн\w* стакан\w*|double cup|sipp?\w*|in (?:my|the) cup")
_ENTERTAINMENT = _pattern(r"майкл\w* джексон\w*|michael jackson|lil xan|ватсон|watson|джордан\w*|jordan|слуша\w*|трек\w*|бит\w*|альбом\w*|playlist|soundtrack|song|beat|track|tiktok|тикток\w*")
_NAMED_PERSON = _pattern(r"имя (?:кот\w*|персонаж\w*|геро\w*)|персонаж\w*")
_MOLLY_AS_PERSON = _pattern(r"(?:molly|молли)\s+(?:пришла|ответила|позвонила)")
_SNOW_LITERAL = _pattern(r"на крыше|сугроб\w*|снегопад\w*|снег сып\w*|прогноз погоды")
_EXAMPLES = re.compile(r"\bне\s+(наркоман)\b|\bкурю\s+сигарет[уы]?\b|\bмешаю\s+тесто\b|\bиз-за\s+тебя\s+блюю\b", re.I)
_PREPARATION = _pattern(
    r"меша(?:ю|ешь|ет|ем|ете|ют|л[аио]?|ть)|смешива\w*|смеша(?:л[аио]?|ю|ть)|"
    r"(?:за|под|пере|раз)меша(?:л[аио]?|ю|ть)|размешива\w*|вар(?:ю|ишь|ит|им|ите|ят|ил[аои]?|ить)|"
    r"фасу\w*|расфасу\w*|расфасова\w*"
)
_UNSPECIFIED_OBJECT = _pattern(
    r"(?:что|чем|чего)[-‑– ]то|кое[-‑– ]что|какую[-‑– ]то|какой[-‑– ]то|какое[-‑– ]то"
)
_UNSPECIFIED_USE = _pattern(
    r"закинул\w*|вкинул\w*|глота\w*|проглоти\w*|нюха\w*|занюха\w*|нюхнул\w*|"
    r"курю|курил\w*|курим"
)
_UNSPECIFIED_MATERIAL = _pattern(r"порошок|порошк[ауеом]+|смес(?:ь|и|ью|ей)")
_COOKING = _pattern(r"тест[аоуем]+|мук[ауиой]*|яйц[аоу]*|суп\w*|борщ\w*|на кухне|макарон\w*|кашу|кофе")
_EVERYDAY_PREPARATION = _pattern(
    r"краск\w*|бетон\w*|цемент\w*|кле[йяюем]\w*|шпатл\w*|строительн\w*|"
    r"меша\w*\s+(?:спать|уснуть|работать|думать|жить|мне|тебе|ему|ей|нам|вам|им)|"
    r"(?:мне|тебе|ему|ей|нам|вам|им)\s+(?:что[-‑– ]то\s+)?меша(?:ет|ют|ло|ли)"
)
_TOBACCO = _pattern(r"сигарет\w*|табак\w*|табач\w*|cigarettes?|tobacco")
_WORD = re.compile(r"[^\W\d_]+")
_CLAUSE = re.compile(r"[^,;.!?…]+")
_ACTION_GAP = re.compile(
    r"\s*(?:(?:же|себе|это|этот|эту|эти|весь|всю|вчера|сегодня|снова|опять|только|"
    r"just|some|the|this|again|yesterday|today)\s+)*", re.I,
)
_EFFECT_GAP = re.compile(r"\s*,?\s*(?:и\s+)?(?:(?:меня|его|её|ее|нас|me|him|her|us)\s+)?", re.I)
_MEDICAL = _pattern(
    r"врач\w*|доктор\w*|по рецепту|рецепт\w*|аптек\w*|назначил\w*|"
    r"прописал\w*|от (?:головы|боли|температуры|простуды|кашля)|"
    r"витамин\w*|аспирин\w*|ибупрофен\w*|парацетамол\w*|антибиотик\w*|"
    r"таблетк\w* от аллергии|по назначению|больниц\w*|clinic|doctor|prescribed|"
    r"prescription|headache|vitamins?|ibuprofen|antibiotics?"
)
_VEHICLE = _pattern(
    r"машин\w*|авто\w*|шин\w*|резин\w*|велосипед\w*|диск\w*|рул\w*|"
    r"поворот\w*|гараж\w*|проколо?л\w*|заменил\w*|поменял\w*|"
    r"колесо обозрения|шиномонтаж\w*|фур\w*|тормоз\w*|самокат\w*|"
    r"багажник\w*|покрыш\w*|запасн\w*|трасс\w*|болид\w*|драг[-‑ ]рейсинг\w*|cars?|tires?|tyres?|bikes?|steering|"
    r"fuel|gas station|truck|motorcycle|track day|spare|wheel of fortune"
)
_LITERAL = _pattern(
    r"косил\w*|газон\w*|сад\w*|клумб\w*|ёлк\w*|соснов\w*|обой\w*|"
    r"белк\w*|суп\w*|перец\w*|фен для волос|растени\w*|сорняк\w*|"
    r"мчусь|скорость|летим|speed limit|weeding|garden|cooking|kitchen|soda|"
    r"музык\w*|рендер\w*|фотограф\w*|мороз\w*|зим\w*|снежин\w*|ступ\w*|"
    r"напит\w*|cola|weather|winter|snowfall|drink|salt and pepper"
)
_NAME = _pattern(
    r"ватсон|watson|познакомил\w*|девушк\w*|подруг\w*|зовут|"
    r"позвонил\w*|ответила|called|met|dating|girlfriend|my friend|character|spider[-‑ ]man"
)
_POTENCY = _pattern(
    r"торк\w*|упоро\w*|наркотическ\w*|"
    r"передоз\w*|с (?:кайфом|трипом)|под кайфом|ломка|отходняк|трипанул\w*|to get high|"
    r"gets? (?:me|you|us) high|getting high|rolling hard|overdos\w*|stoned|strung out|coming down"
)
_SWALLOW = _pattern(r"закину\w*|закин[ье]\w*|глота\w*|проглоти\w*|скуша\w*|кида\w*|popp?ed|popping|swallow\w*")
_SMOKE = _pattern(r"курю|курил\w*|кури\w*|курим|курят|курить|дымлю|дымил\w*|раскур\w*|тяну\w*|smok\w*|roll\w*")
_DEAL = _pattern(r"закладк\w*|барыг\w*|дилер\w*|доз\w*|стафф\w*|drug deal\w*|dealer|наркокурьер\w*|наркосбыт\w*|драг[-‑ ]дилер\w*|plug|baggy|stash")
_REPLACE_LOOKALIKES = str.maketrans("aceopxykmtbh", "асеорхукмтвн")
_HAS_CYRILLIC = re.compile("[а-яё]", re.I)


def _normalize(word):
    word = unicodedata.normalize("NFKC", word).casefold().replace("ё", "е")
    return word.translate(_REPLACE_LOOKALIKES) if _HAS_CYRILLIC.search(word) else word


def _one_edit(word, term):
    if word == term:
        return True
    if len(word) == len(term):
        mismatches = [i for i, (left, right) in enumerate(zip(word, term)) if left != right]
        return len(mismatches) == 1 or (
            len(mismatches) == 2 and mismatches[1] == mismatches[0] + 1
            and word[mismatches[0]:mismatches[1] + 1] == term[mismatches[0]:mismatches[1] + 1][::-1]
        )
    if abs(len(word) - len(term)) != 1:
        return False
    longer, shorter = sorted((word, term), key=len, reverse=True)
    first_difference = next((i for i, (left, right) in enumerate(zip(longer, shorter)) if left != right), len(shorter))
    return longer[first_difference + 1:] == shorter[first_difference:]


@lru_cache(maxsize=2048)
def _close_term(word):
    normalized = _normalize(word)
    if len(normalized) < 6:
        return None
    if normalized in _FUZZY:
        return normalized
    matches = {term for term in _FUZZY if _one_edit(normalized, term)}
    return next(iter(matches)) if len(matches) == 1 else None


def _clause_bounds(line, start, end):
    return next(
        (item.span() for item in _CLAUSE.finditer(line) if item.start() <= start and end <= item.end()),
        (0, len(line)),
    )


def _context_for(line, start, end):
    left, right = _clause_bounds(line, start, end)
    return line[max(left, start - 55):min(right, end + 55)]


def _catalog_expression(term):
    return re.escape(term).replace("'", "['’]").replace(r"\ ", r"\s+").replace(r"\-", "[-–—‑]")


@lru_cache(maxsize=1)
def substance_catalog():
    path = Path(__file__).resolve().parent / "docs" / "panda-substance-names.json"
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _confirmed_pattern():
    records = substance_catalog()
    terms = sorted(records["ru"] + records["us"], key=len, reverse=True)
    expressions = [_catalog_expression(term) for term in terms]
    for term in records["ru"]:
        if re.fullmatch(r"[а-яё]{7,}[бвгджзклмнпрстфхцчшщ]", term):
            expressions.append(_catalog_expression(term) + r"(?:ами|ах|ов|ом|а|у|ы|е)")
    base = _EXPLICIT.pattern.removeprefix(r"(?<!\w)(?:").removesuffix(r")(?!\w)")
    return _pattern("|".join([*expressions, base]))


@lru_cache(maxsize=1)
def slang_catalog():
    path = Path(__file__).resolve().parent / "docs" / "panda-dea-slang.json"
    terms = set(json.loads(path.read_text(encoding="utf-8")))
    terms.update(substance_catalog()["reference_aliases"])
    ordered = tuple(sorted(terms))
    return ordered, _pattern("|".join(_catalog_expression(term) for term in sorted(terms, key=len, reverse=True)))


def _overlap(left, right):
    return left[0] < right[1] and left[1] > right[0]


def _add_suggestion(suggestions, start, end, reason):
    suggestions.setdefault((start, end), reason)


def _merge_marks(marks):
    """Resolve overlaps without extending either color to unmatched characters."""
    changes = defaultdict(Counter)
    for start, end, color in set(marks):
        changes[start][color] += 1
        changes[end][color] -= 1
    active = Counter()
    merged = []
    previous = 0
    for position in sorted(changes):
        color = "red" if active["red"] else "yellow" if active["yellow"] else None
        if color and previous < position:
            if merged and merged[-1][1:] == (previous, color):
                merged[-1] = (merged[-1][0], position, color)
            else:
                merged.append((previous, position, color))
        active.update(changes[position])
        previous = position
    return merged


def _linked_to_term(line, cue, start, end, effect):
    if cue.end() <= start:
        gap = line[cue.end():start]
        return len(gap) <= 25 and bool(_ACTION_GAP.fullmatch(gap))
    if end <= cue.start():
        gap = line[end:cue.start()]
        pattern = _EFFECT_GAP if effect else _ACTION_GAP
        return len(gap) <= 25 and bool(pattern.fullmatch(gap))
    return False


def _has_linked_cue(line, hit, pattern, *, effect=False):
    return any(_linked_to_term(line, cue, *hit.span(), effect) for cue in pattern.finditer(line))


def screen_lyrics(rows, memo, *, cancelled=None):
    """Return color-coded marks and suggestions without rewriting the text."""
    confirmed = _confirmed_pattern()
    memo_text = _normalize(memo)
    known_alias = "|".join(
        pattern for name, pattern in (
            ("лед", r"л[её]д[ауом]*"),
            ("белый", r"бел(?:ый|ого|ым)"),
            ("лирика", r"лирик(?:а|у|ой|и)"),
        )
        if _pattern(name).search(memo_text)
    )
    ambiguous = [_TABLETS, _CANNABIS, _PARTY, _OTHER]
    if known_alias:
        ambiguous.append(_pattern(known_alias))

    administration = [list(_GUM_DRUG.finditer(line)) for line in rows]
    marks_by_line = []
    suggestions = []
    for index, line in enumerate(rows):
        if cancelled and cancelled():
            raise InterruptedError("Lyric review cancelled")
        marks = [(*hit.span(), "red") for hit in confirmed.finditer(line)]
        marks.extend((*hit.span("term"), "red") for hit in administration[index])
        connected_use = any(administration[max(0, index - 1):index + 2])
        candidates = {}
        nearby = " ".join(rows[max(0, index - 1): index + 2])
        for pattern in ambiguous:
            for hit in pattern.finditer(line):
                context = _context_for(line, *hit.span())
                term = hit.group()
                tablet = bool(pattern is _TABLETS and _TABLET_WORD.fullmatch(term))
                wheel = bool(pattern is _TABLETS and _WHEEL_WORD.fullmatch(term))
                if (tablet and _DEVICE.search(context)) or (wheel and _VEHICLE.search(context)):
                    continue
                if pattern in (_CANNABIS, _OTHER) and _LITERAL.search(context):
                    continue
                if _PERSON_ALIAS.fullmatch(term) and (
                    _NAME.search(context) or _NAMED_PERSON.search(context) or _MOLLY_AS_PERSON.search(context)
                ):
                    continue

                medical = bool(pattern is _TABLETS and _MEDICAL.search(context))
                potency = _has_linked_cue(line, hit, _POTENCY, effect=True) and not _SOBER_EFFECT.search(line)
                strong = potency
                if pattern is _CANNABIS:
                    strong = strong or (_has_linked_cue(line, hit, _SMOKE) and not _TOBACCO.search(context))
                elif pattern is _TABLETS:
                    ingestion = _has_linked_cue(line, hit, _SWALLOW)
                    strong = strong or (ingestion and (wheel or _DEAL.search(context)))
                    strong = strong or (_PARTY_CONTEXT.search(context) and _has_linked_cue(line, hit, _PROCURING))
                elif pattern is _PARTY:
                    strong = strong or (_has_linked_cue(line, hit, _SWALLOW) and not _MEDICAL.search(context))
                if strong and not medical:
                    marks.append((*hit.span(), "red"))
                elif tablet:
                    _add_suggestion(candidates, *hit.span(), "Таблетки без явного наркотического контекста")
                elif (pattern is _TABLETS or pattern is _PARTY or confirmed.search(nearby)
                      or _DEAL.search(context) or _REVIEW_ALONE.fullmatch(term)):
                    _add_suggestion(candidates, *hit.span(), "Неоднозначное слово или сленг")

        if connected_use:
            for match in _GET_WHEELS.finditer(line):
                context = _context_for(line, *match.span())
                if not (_VEHICLE.search(context) or _MEDICAL.search(context)):
                    _add_suggestion(candidates, *match.span("term"), "Соседнее упоминание может уточнять значение")

        for match in _SMOKE_OBJECT.finditer(line):
            context = _context_for(line, *match.span())
            if not _TOBACCO.search(context):
                group = "before" if match["before"] else "after"
                marks = [mark for mark in marks if not _overlap(mark, match.span())]
                marks.append((*match.span(group), "red"))

        for match in _MOLLY_STATE.finditer(line):
            context = _context_for(line, *match.span())
            if not (_ENTERTAINMENT.search(context) or _NAME.search(context) or _NAMED_PERSON.search(context)):
                marks.append((*match.span("term"), "red"))

        for pattern in (_XAN_SHORT, _LEAN_ALIAS, _MJ_SHORT, _SNOW_STYLE):
            for hit in pattern.finditer(line):
                term = hit.group().casefold()
                context = _context_for(line, *hit.span())
                if _MEDICAL.search(context) or _ENTERTAINMENT.search(context) or _NAMED_PERSON.search(context):
                    continue
                if pattern is _XAN_SHORT:
                    left, _ = _clause_bounds(line, *hit.span())
                    before = line[max(left, hit.start() - 30):hit.start()]
                    ingestion = _XAN_INGESTION.search(before)
                    measured = _XAN_QUANTITY.search(before) and _LIQUID_USE.search(line)
                    strong = (
                        ingestion or measured or _has_linked_cue(line, hit, _SWALLOW)
                        or _has_linked_cue(line, hit, _LIQUID_USE)
                    )
                    if ingestion:
                        marks.append((hit.start() - len(before) + ingestion.start("action"),
                                      hit.start() - len(before) + ingestion.end("action"), "red"))
                elif pattern is _LEAN_ALIAS:
                    strong = _has_linked_cue(line, hit, _LIQUID_USE) and not _COOKING.search(context)
                    if term.startswith("сироп"):
                        if _SWEET_SYRUP.search(context):
                            continue
                        strong = strong and (confirmed.search(nearby) or _NAMED_LEAN.search(nearby))
                elif pattern is _MJ_SHORT:
                    strong = _has_linked_cue(line, hit, _SMOKE) and not _TOBACCO.search(context)
                else:
                    strong = False
                    if _SNOW_LITERAL.search(context):
                        continue
                    if not (_CANNABIS.search(nearby) or confirmed.search(nearby) or _POTENCY.search(nearby)):
                        continue
                if strong:
                    marks.append((*hit.span(), "red"))
                elif (not term.startswith("сироп") or confirmed.search(nearby)
                      or _NAMED_LEAN.search(nearby) or _POTENCY.search(context)):
                    _add_suggestion(candidates, *hit.span(), "Сленг, проверь значение по соседним строкам")

        for match in _EXAMPLES.finditer(line):
            marks = [mark for mark in marks if not _overlap(mark, match.span())]
            if match.lastindex is not None:
                marks.append((*match.span(match.lastindex), "red"))
        for action in _PREPARATION.finditer(line):
            context = _context_for(line, *action.span())
            if _has_linked_cue(line, action, confirmed):
                marks.append((*action.span(), "red"))
            elif not (_COOKING.search(context) or _EVERYDAY_PREPARATION.search(context) or _MEDICAL.search(context)):
                if (_has_linked_cue(line, action, _UNSPECIFIED_OBJECT)
                    or _has_linked_cue(line, action, _UNSPECIFIED_MATERIAL) or confirmed.search(nearby)):
                    _add_suggestion(candidates, *action.span(), "Возможное приготовление, проверь, о чём речь")

        for action in _UNSPECIFIED_USE.finditer(line):
            context = _context_for(line, *action.span())
            if (_has_linked_cue(line, action, _UNSPECIFIED_OBJECT)
                and not (_MEDICAL.search(context) or _TOBACCO.search(context) or _COOKING.search(context))):
                _add_suggestion(candidates, *action.span(), "Возможное употребление, объект не указан")

        anchors = [(start, end) for start, end, color in marks if color == "red"]
        for cue in (*_USE.finditer(line), *_TRAFFIC.finditer(line), *_EFFECT.finditer(line)):
            context = _context_for(line, *cue.span())
            effect = bool(_EFFECT.fullmatch(cue.group()))
            if (_SOBER_EFFECT.search(context) or _MEDICAL.search(context)
                or (_SMOKE.fullmatch(cue.group()) and _TOBACCO.search(context))
                or (_TRAFFIC.fullmatch(cue.group()) and _COOKING.search(context))):
                continue
            tied = any(_linked_to_term(line, cue, start, end, effect) for start, end in anchors)
            if tied:
                marks.append((*cue.span(), "red"))
            elif effect and _POTENCY.fullmatch(cue.group()):
                _add_suggestion(candidates, *cue.span(), "Возможный признак употребления")
        if confirmed.search(line) or (_POTENCY.search(line) and (_USE.search(line) or _DEAL.search(line))):
            for hit in slang_catalog()[1].finditer(line):
                context = _context_for(line, *hit.span())
                if _MEDICAL.search(context) or _VEHICLE.search(context) or _LITERAL.search(context) or _NAME.search(context):
                    continue
                if confirmed.fullmatch(hit.group()):
                    continue
                if not (_USE.search(context) or _DEAL.search(context) or _POTENCY.search(context)):
                    continue
                if " " in hit.group() or (confirmed.search(context) and _POTENCY.search(context)):
                    _add_suggestion(candidates, *hit.span(), "Словарный вариант в наркотическом контексте")

        for hit in _WORD.finditer(line):
            if any(_overlap(mark, hit.span()) for mark in marks):
                continue
            term = _close_term(hit.group())
            if term:
                _add_suggestion(candidates, *hit.span(), f"Похоже на «{term}»")

        # A confirmed match takes precedence over an ambiguous reading of the same text.
        red_marks = tuple(marks)
        for (start, end), reason in sorted(candidates.items()):
            if any(_overlap(mark, (start, end)) for mark in red_marks):
                continue
            marks.append((start, end, "yellow"))
            suggestions.append({"line": index + 1, "text": line[start:end], "reason": reason})
        marks_by_line.append(_merge_marks(marks))
    return marks_by_line, suggestions
