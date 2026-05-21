import os
import csv
import json
import re
from dotenv import load_dotenv
import assemblyai as aai
import random
from openai import OpenAI
from pydub import AudioSegment

try:
    import imageio_ffmpeg
    AudioSegment.converter = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    pass

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR = os.path.join(BASE_DIR, 'data')
AUDIO_DIR = os.path.join(DATA_DIR, 'audio')

load_dotenv(os.path.join(BASE_DIR, '.env'))
ASSEMBLYAI_API_KEY = (os.getenv("ASSEMBLYAI_API_KEY") or "").strip()
OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()

client = OpenAI(api_key=OPENAI_API_KEY)

DRILL_TYPES = {
    'rebuttal': 'Rebuttal Speech',
    'speed': 'Speed Reading',
    'impact': 'Impact Extension',
    'contentions': 'Contention Storm',
}

SPEED_PASSAGES_FILE = os.path.join(DATA_DIR, 'speed_passages.json')
SPEED_PASSAGE_REUSE_THRESHOLD = 20


def _json_from_model(messages, fallback, max_tokens=700):
    response = client.chat.completions.create(
        model="gpt-4o-mini-2024-07-18",
        max_tokens=max_tokens,
        temperature=0.7,
        response_format={"type": "json_object"},
        messages=messages
    )

    try:
        return json.loads(response.choices[0].message.content)
    except json.JSONDecodeError:
        return fallback


def _truncate_for_flow(text, limit=2500):
    text = (text or '').strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(' ', 1)[0] + " ..."


def _looks_like_speed_passage(text):
    text = (text or '').strip()
    if not text:
        return False

    lower_text = text.lower()
    instruction_starts = (
        "discuss ",
        "explain ",
        "write ",
        "describe ",
        "argue ",
        "respond ",
        "list ",
    )
    if lower_text.startswith(instruction_starts):
        return False

    return len(re.findall(r"\b[\w']+\b", text)) >= 30


def _word_count(text):
    return len(re.findall(r"\b[\w']+\b", text or ""))


def speed_passage_word_target(timer_seconds):
    try:
        timer_seconds = int(timer_seconds)
    except (TypeError, ValueError):
        timer_seconds = 60

    return min(max(round(timer_seconds * 5), 30), 600)


def _fit_speed_passage_to_target(text, target_words):
    words = re.findall(r"\S+", (text or '').strip())
    if len(words) <= target_words:
        return (text or '').strip()

    trimmed = " ".join(words[:target_words]).strip()
    if trimmed and trimmed[-1] not in ".!?":
        trimmed += "."
    return trimmed


def _speed_fallback_passage(target_words):
    sentences = [
        "Debate rewards students who can read quickly, listen carefully, and make clear decisions under pressure.",
        "A strong speaker does not simply move fast; they choose words with purpose and keep every claim connected to a reason.",
        "When a round becomes complicated, the best debaters slow their thinking down even while their voice stays energetic.",
        "They identify the main conflict, explain why it matters, and compare impacts in language the judge can follow.",
        "Speed reading practice builds that control because it forces the speaker to balance pace, breathing, and accuracy.",
        "If the words blur together, the argument loses force, but if the delivery is too slow, important analysis may never arrive.",
        "The goal is not noise or panic; the goal is efficient communication.",
        "Good practice also teaches recovery.",
        "A speaker might stumble on a phrase, pause for a breath, and then return to the sentence without losing confidence.",
        "Over time, those small recoveries become part of a calm rhythm.",
        "Students who practice this way usually become easier to flow because their transitions are cleaner and their emphasis is more deliberate.",
        "They know when to press forward, when to mark a key phrase, and when to let a judge absorb the point.",
        "In tournament rounds, that skill can decide close debates.",
        "The team with the clearest explanation of the most important issue often beats the team with more disconnected material.",
        "A good speech therefore sounds fast, organized, and intentional at the same time.",
        "Every sentence should help the listener understand what is being won, what is being answered, and why the ballot should move in one direction.",
    ]
    passage = " ".join(sentences)
    while _word_count(passage) < target_words:
        passage = f"{passage} {passage}"
    return _fit_speed_passage_to_target(passage, target_words)


def _load_speed_passages():
    if not os.path.exists(SPEED_PASSAGES_FILE):
        return []

    try:
        with open(SPEED_PASSAGES_FILE, encoding='utf-8') as file:
            passages = json.load(file)
    except (json.JSONDecodeError, OSError):
        return []

    return [
        passage for passage in passages
        if isinstance(passage, dict) and _looks_like_speed_passage(passage.get('prompt'))
    ]


def _save_speed_passage(drill):
    if not _looks_like_speed_passage(drill.get('prompt')):
        return

    os.makedirs(DATA_DIR, exist_ok=True)
    passages = _load_speed_passages()
    normalized_prompt = re.sub(r'\s+', ' ', drill.get('prompt', '').strip()).lower()
    existing_prompts = {
        re.sub(r'\s+', ' ', passage.get('prompt', '').strip()).lower()
        for passage in passages
    }

    if normalized_prompt in existing_prompts:
        return

    passages.append({
        "title": DRILL_TYPES['speed'],
        "topic": drill.get('topic') or "Speed Reading",
        "prompt": drill.get('prompt', '').strip(),
        "task": "Read the passage aloud, then submit your recording.",
        "timer_seconds": drill.get('timer_seconds') or 60,
    })

    with open(SPEED_PASSAGES_FILE, 'w', encoding='utf-8') as file:
        json.dump(passages, file, indent=2)


def _cached_speed_drill(timer_seconds=None):
    passages = _load_speed_passages()
    if len(passages) < SPEED_PASSAGE_REUSE_THRESHOLD:
        return None

    drill = dict(random.choice(passages))
    drill['title'] = DRILL_TYPES['speed']
    drill['task'] = "Read the passage aloud, then submit your recording."
    drill['timer_seconds'] = timer_seconds or drill.get('timer_seconds') or 60
    return drill


def _winner_side_from_rfd(rfd):
    first_word = ((rfd or '').strip().split() or ['unknown'])[0].lower()
    if first_word == 'for':
        return 'aff'
    if first_word == 'against':
        return 'neg'
    return first_word


def _flow_item(tag='Untitled', summary='Open transcripts for details.'):
    return {
        "tag": (tag or "Untitled").strip(),
        "summary": (summary or "Open transcripts for details.").strip(),
    }


def _normalize_flow_items(items, prefix):
    normalized = []
    for index, item in enumerate(items or [], start=1):
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or f"{prefix}{index}")
        normalized.append({
            "id": item_id,
            "tag": item.get("tag") or f"{prefix.upper()} {index}",
            "summary": item.get("summary") or "Open transcripts for details.",
        })
    return normalized[:4]


def _items_for_target(links, target_key, target_id, source_lookup=None):
    items = []
    for link in links or []:
        if not isinstance(link, dict) or str(link.get(target_key)) != str(target_id):
            continue

        source = {}
        source_id = link.get("neg_id") or link.get("aff_id")
        if source_lookup and source_id is not None:
            source = source_lookup.get(str(source_id), {})

        items.append(_flow_item(
            link.get("tag") or source.get("tag"),
            link.get("summary") or source.get("summary")
        ))
    return items


def _aff_row_status(neg_responses, aff_defense):
    if not neg_responses:
        return "unrefuted", "The negative did not directly answer this affirmative contention."
    if aff_defense:
        return "contested", "The negative answered this point, and the affirmative gave later defense."
    return "refuted", "The negative answered this point, and no later affirmative defense was identified."


def _neg_row_status(aff_rebuttals):
    if not aff_rebuttals:
        return "unrefuted", "The affirmative did not directly answer this negative contention."
    return "contested", "The affirmative gave a rebuttal to this negative contention."


def _build_flow_from_analysis(analysis, rfd, fallback):
    if not isinstance(analysis, dict):
        return fallback

    aff_contentions = _normalize_flow_items(analysis.get("aff_contentions"), "a")
    neg_contentions = _normalize_flow_items(analysis.get("neg_contentions"), "n")

    if not aff_contentions and not neg_contentions:
        return fallback

    aff_lookup = {item["id"]: item for item in aff_contentions}
    neg_lookup = {item["id"]: item for item in neg_contentions}
    neg_to_aff = analysis.get("neg_responses_to_aff") or []
    aff_defense_to_aff = analysis.get("aff_defense_to_aff") or []
    aff_to_neg = analysis.get("aff_rebuttals_to_neg") or []

    aff_sheet = []
    for contention in aff_contentions:
        neg_responses = _items_for_target(neg_to_aff, "aff_id", contention["id"], neg_lookup)
        aff_defense = _items_for_target(aff_defense_to_aff, "aff_id", contention["id"], aff_lookup)
        status, judge_note = _aff_row_status(neg_responses, aff_defense)
        aff_sheet.append({
            "contention": _flow_item(contention["tag"], contention["summary"]),
            "neg_responses": neg_responses,
            "aff_defense": aff_defense,
            "status": status,
            "judge_note": judge_note,
        })

    neg_sheet = []
    for contention in neg_contentions:
        aff_rebuttals = _items_for_target(aff_to_neg, "neg_id", contention["id"], aff_lookup)
        status, judge_note = _neg_row_status(aff_rebuttals)
        neg_sheet.append({
            "contention": _flow_item(contention["tag"], contention["summary"]),
            "aff_rebuttals": aff_rebuttals,
            "status": status,
            "judge_note": judge_note,
        })

    aff_unrefuted = sum(1 for row in aff_sheet if row["status"] == "unrefuted")
    neg_unrefuted = sum(1 for row in neg_sheet if row["status"] == "unrefuted")
    if aff_unrefuted > neg_unrefuted:
        flow_winner = "aff"
    elif neg_unrefuted > aff_unrefuted:
        flow_winner = "neg"
    else:
        flow_winner = _winner_side_from_rfd(rfd)

    ballot = analysis.get("ballot") if isinstance(analysis.get("ballot"), dict) else {}
    return {
        "aff_sheet": aff_sheet or fallback["aff_sheet"],
        "neg_sheet": neg_sheet or fallback["neg_sheet"],
        "ballot": {
            "aff_unrefuted": aff_unrefuted,
            "neg_unrefuted": neg_unrefuted,
            "winner": flow_winner,
            "explanation": ballot.get("explanation") or _truncate_for_flow(rfd, 180),
        },
        "dropped": (analysis.get("dropped") or [])[:4],
        "voters": (analysis.get("voters") or fallback["voters"])[:3],
        "recommended_drills": (analysis.get("recommended_drills") or fallback["recommended_drills"])[:4],
    }


def generate_round_flow(topic, aff_speech, neg_speech, aff_rebuttal, rfd):
    fallback = {
        "aff_sheet": [
            {
                "contention": {
                    "tag": "Aff case",
                    "summary": "Review the transcript for the main affirmative argument."
                },
                "neg_responses": [
                    {
                        "tag": "Neg response",
                        "summary": "Review the transcript for the main negative response."
                    }
                ],
                "aff_defense": [
                    {
                        "tag": "Aff defense",
                        "summary": "Review the transcript for the main affirmative defense."
                    }
                ],
                "status": "contested",
                "judge_note": "Flow generation was unavailable."
            }
        ],
        "neg_sheet": [
            {
                "contention": {
                    "tag": "Neg case",
                    "summary": "Review the transcript for the main negative contention."
                },
                "aff_rebuttals": [
                    {
                        "tag": "Aff rebuttal",
                        "summary": "Review the transcript for the affirmative rebuttal."
                    }
                ],
                "status": "contested",
                "judge_note": "Flow generation was unavailable."
            }
        ],
        "ballot": {
            "aff_unrefuted": 0,
            "neg_unrefuted": 0,
            "winner": _winner_side_from_rfd(rfd),
            "explanation": _truncate_for_flow(rfd, 180)
        },
        "dropped": [],
        "voters": [
            {
                "tag": "Winning contention / impact",
                "winner": _winner_side_from_rfd(rfd),
                "reason": _truncate_for_flow(rfd, 160)
            }
        ],
        "recommended_drills": ["rebuttal", "impact"]
    }

    response = client.chat.completions.create(
        model="gpt-4o-mini-2024-07-18",
        max_tokens=850,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You analyze parliamentary debate speeches as JSON. Do not create final UI flow sheets. "
                    "The app will build aff_sheet and neg_sheet itself. "
                    "Return JSON only with keys: aff_contentions, neg_contentions, neg_responses_to_aff, "
                    "aff_defense_to_aff, aff_rebuttals_to_neg, ballot, dropped, voters, recommended_drills. "
                    "aff_contentions and neg_contentions: max 4 each, objects with id, tag, summary. "
                    "Use stable ids like a1, a2, n1, n2. tag <= 8 words. summary <= 18 words. "
                    "neg_responses_to_aff: objects with aff_id, optional neg_id, tag, summary. Include direct "
                    "negative answers, turns, and negative contentions that directly clash with an aff contention. "
                    "aff_defense_to_aff: objects with aff_id, tag, summary. Include later affirmative defense of "
                    "an aff contention from the rebuttal speech. "
                    "aff_rebuttals_to_neg: objects with neg_id, tag, summary. Include affirmative rebuttals that "
                    "answer negative contentions, even when phrased as defense of the aff case. "
                    "Do not create placeholders. Empty arrays mean no direct or implicit clash was found. "
                    "ballot has explanation only; the app counts unrefuted rows and chooses winner. "
                    "dropped max 4. voters max 3. Each voter winner must be aff or neg. "
                    "recommended_drills can only include: rebuttal, impact, contentions, speed. "
                    "Do not quote long text."
                )
            },
            {
                "role": "user",
                "content": (
                    f"Topic: {_truncate_for_flow(topic, 300)}\n\n"
                    f"AFF CONSTRUCTIVE:\n{_truncate_for_flow(aff_speech)}\n\n"
                    f"NEG SPEECH:\n{_truncate_for_flow(neg_speech)}\n\n"
                    f"AFF REBUTTAL:\n{_truncate_for_flow(aff_rebuttal)}\n\n"
                    f"JUDGE RFD:\n{_truncate_for_flow(rfd, 1200)}"
                )
            }
        ]
    )

    try:
        flow = json.loads(response.choices[0].message.content)
    except json.JSONDecodeError:
        return fallback

    return _build_flow_from_analysis(flow, rfd, fallback)


def generate_drill(drill_type, timer_seconds=None):
    if drill_type not in DRILL_TYPES:
        raise ValueError("Unknown drill type.")

    if drill_type == 'speed':
        timer_seconds = timer_seconds or 60
        word_target = speed_passage_word_target(timer_seconds)
        cached_drill = _cached_speed_drill(timer_seconds)
        if cached_drill:
            return cached_drill
    else:
        timer_seconds = timer_seconds or 60
        word_target = None

    drill_guidance = {
        'rebuttal': (
            "Create a compact debate argument for the user to rebut. Include a topic, side, "
            "and one paragraph argument with claim, warrant, and impact."
        ),
        'speed': (
            "Create a speed-reading passage about debate, sports, school, or technology. "
            f"It must be about {word_target} words total, readable aloud, and include "
            "varied punctuation so the user can practice pacing. The prompt must be the exact "
            "words the user should read aloud. The task must only tell the user to read the "
            "passage aloud; do not ask them to discuss, explain, write, or answer anything."
        ),
        'impact': (
            "Create one underdeveloped debate argument. The user must impact it out fully "
            "by explaining magnitude, probability, timeframe, and weighing."
        ),
        'contentions': (
            "Use the provided debate resolution and side. The user must brainstorm as many "
            "contention taglines as possible, not full arguments."
        ),
    }

    fallback = {
        "title": DRILL_TYPES[drill_type],
        "topic": "Resolved: Schools should require financial literacy classes.",
        "prompt": _speed_fallback_passage(word_target) if drill_type == 'speed' else "Schools should require financial literacy because students need practical skills for adulthood.",
        "task": "Read the passage aloud, then submit your recording." if drill_type == 'speed' else "Give your response aloud, then submit your recording.",
        "timer_seconds": timer_seconds,
    }

    if drill_type == 'contentions':
        topic = random.choice([get_parli_topic(None), get_mspdp_topic()])
        side = random.choice(['affirmative', 'negation'])
        return {
            "title": DRILL_TYPES[drill_type],
            "topic": topic,
            "prompt": f"Side: {side}\nResolution: {topic}",
            "task": "List as many distinct contention taglines as you can. Do not write full warrants.",
            "timer_seconds": 60,
        }

    drill = _json_from_model(
        [
            {
                "role": "system",
                "content": (
                    "You create concise high school debate practice drills. Return only JSON "
                    "with keys: title, topic, prompt, task, timer_seconds. Make prompts specific, "
                    "clear, and useful for practice. For Speed Reading, prompt must be a read-aloud "
                    "passage, not an instruction or discussion question."
                )
            },
            {"role": "user", "content": drill_guidance[drill_type]},
        ],
        fallback,
        max_tokens=1400 if drill_type == 'speed' else 700
    )

    if drill_type == 'speed':
        drill['title'] = DRILL_TYPES['speed']
        drill['task'] = "Read the passage aloud, then submit your recording."
        drill['timer_seconds'] = timer_seconds
        if not _looks_like_speed_passage(drill.get('prompt')):
            drill['prompt'] = fallback['prompt']
        drill['prompt'] = _fit_speed_passage_to_target(drill.get('prompt'), word_target)
        _save_speed_passage(drill)
    elif drill_type in {'rebuttal', 'impact'}:
        drill['task'] = "Give your response aloud, then submit your recording."

    return drill


def score_drill(drill_type, drill, response_text):
    if drill_type not in DRILL_TYPES:
        raise ValueError("Unknown drill type.")

    rubric = {
        'rebuttal': (
            "Judge only logical clash: whether the response directly answers the claim, "
            "attacks the warrant/link chain, and explains why the impact no longer matters. "
            "Do not require, reward, or penalize use of cited evidence, statistics, or sources."
        ),
        'impact': "Judge magnitude, probability, timeframe, weighing, and whether the impact chain is complete.",
        'contentions': "Judge number, diversity, strategic usefulness, and whether taglines are distinct.",
        'speed': "Do not score speed reading here.",
    }

    fallback = {
        "score": 0,
        "headline": "Feedback unavailable",
        "strengths": [],
        "improvements": ["Try again with a fuller response."],
        "model_answer": "",
    }

    return _json_from_model(
        [
            {
                "role": "system",
                "content": (
                    "You are a debate coach scoring practice drills. Return only JSON with keys: "
                    "score (0-10 integer), headline, strengths (array), improvements (array), "
                    "model_answer. Keep feedback concrete and concise. For rebuttal drills, evaluate "
                    "logic and direct clash only; do not mention missing evidence or citations."
                )
            },
            {
                "role": "user",
                "content": (
                    f"Drill type: {DRILL_TYPES[drill_type]}\n"
                    f"Rubric: {rubric[drill_type]}\n"
                    f"Drill prompt: {json.dumps(drill)}\n"
                    f"User response:\n{response_text}"
                )
            },
        ],
        fallback
    )


# coin toss

def coin_toss():
    toss = random.randint(0, 1)
    if toss == 0:
        return False
    else:
        return True

# gets a random topic from npdl resolutions database given a tournament

def get_parli_topic(tournament):
    matching_resolutions = []
    all_resolutions = []

    with open(os.path.join(DATA_DIR, 'parlires.csv'), encoding='UTF-16', newline='') as file:
        reader = csv.DictReader(file, delimiter='\t')
        for row in reader:
            resolution = (row.get('Resolution') or '').strip()
            if not resolution:
                continue

            all_resolutions.append(resolution)

            tournament_name = (row.get('Tournament') or '').strip()
            tournament_name = re.sub(r'\s+\d{4}-\d{2}$', '', tournament_name)

            if tournament and tournament_name == tournament:
                matching_resolutions.append(resolution)

    resolutions = matching_resolutions if tournament else all_resolutions
    if not resolutions:
        raise ValueError(f"No Parli topics found for tournament: {tournament}")

    return random.choice(resolutions)
    
# gets a random topic from mspdp database

def get_mspdp_topic():
    with open(os.path.join(DATA_DIR, 'msres.csv'), newline='') as file:
        reader = csv.DictReader(file, delimiter='\t')
        resolutions = [
            (row.get('Resolution') or '').strip()
            for row in reader
            if (row.get('Resolution') or '').strip()
        ]

    if not resolutions:
        raise ValueError("No MSPDP topics found.")

    return random.choice(resolutions)

# gives a one minute ai generated speech about the topic

def ai_speech(topic):

    # client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)

    message = client.chat.completions.create(
        model="gpt-4o-mini-2024-07-18",
        max_tokens=512,
        temperature=0.0,
        messages=[
            {"role": "system", "content": "You are an affirmative parliamentary debater by the name of Debby. You are required to make a debate case and complementary speech for the topic you are given."},
            {"role": "user", "content": "Make a two minute affirmative speech using a high school parliamentary debate case format style with evidence at average speaking pace about the following topic: " + topic + ". In the start of your speech, you must say: \"Hello my name is Debby.\""}
        ]
    )
    return message.choices[0].message.content

# transcribes the users audio

def transcribe(path, include_words=False):

    """audio_file= open("recording.m4a", "rb")
    transcript = client.audio.transcriptions.create(
    model="whisper-1", 
    file=audio_file
    )"""

    if not ASSEMBLYAI_API_KEY:
        raise ValueError("ASSEMBLYAI_API_KEY is missing from .env")

    if not os.path.exists(path) or os.path.getsize(path) == 0:
        raise ValueError(f"Audio file is missing or empty: {path}")

    upload_path = path
    if not path.lower().endswith('.wav'):
        os.makedirs(AUDIO_DIR, exist_ok=True)
        upload_path = os.path.join(AUDIO_DIR, 'transcription_upload.wav')
        (
            AudioSegment.from_file(path)
            .set_channels(1)
            .set_frame_rate(16000)
            .set_sample_width(2)
            .export(upload_path, format='wav')
        )

    aai.settings.api_key = ASSEMBLYAI_API_KEY
    config = aai.TranscriptionConfig(speech_models=["universal-2"])
    transcriber = aai.Transcriber()
    transcript = transcriber.transcribe(upload_path, config=config)

    if transcript.status == aai.TranscriptStatus.error:
        raise RuntimeError(f"AssemblyAI transcription failed: {transcript.error}")

    if include_words:
        words = [
            {
                'text': word.text,
                'start': word.start,
                'end': word.end
            }
            for word in (transcript.words or [])
        ]
        return transcript.text, words

    return transcript.text

    

# makes a one minute response speech to the users speech about a certain topic

def ai_response(topic, first_speech_transcription):

    message = client.chat.completions.create(
        #model="claude-3-opus-20240229",
        model="gpt-4o-mini-2024-07-18",
        max_tokens=1200,
        temperature=0.0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a negation parliamentary debater named Debby. Write a complete "
                    "negative speech in a high school parliamentary style. The speech must first "
                    "present Debby's own negative contentions, then separately refute the "
                    "affirmative's contentions. If one of Debby's negative contentions directly "
                    "clashes with an affirmative contention, cross-apply it in the refutation "
                    "section instead of repeating the whole argument."
                )
            },
            {
                "role": "user",
                "content": (
                    "Given the following topic:\n"
                    + topic
                    + "\n\nAffirmative speech:\n"
                    + first_speech_transcription
                    + "\n\nWrite a two-minute negation speech at average speaking pace. "
                    "Start exactly with: \"Hello my name is Debby.\" "
                    "Use this order:\n"
                    "1. Brief roadmap.\n"
                    "2. Debby's negative contentions, with clear taglines and logical warrants.\n"
                    "3. Refutation of the affirmative speech, answering each major affirmative contention.\n"
                    "4. Short weighing/summary.\n"
                    "Do not start with refutation. Do not mix refutation into the negative case except "
                    "for brief signposting. In the refutation section, you may cross-apply Debby's own "
                    "contentions when they directly answer the affirmative."
                )
            }
        ]
    )
    return message.choices[0].message.content

# decides a winner based on a for speech, against speech, and topic

def winner(first_speech_transcription, against_speech, second_speech_transcription, topic):
    # Ensure you have all the necessary inputs
    print("For Speech:", first_speech_transcription)
    print("Against Speech:", against_speech)
    print("User Second Speech:", second_speech_transcription)

    if not (first_speech_transcription and against_speech and second_speech_transcription):
        raise ValueError("Both speeches and AI response are required for winner determination!")


    message = client.chat.completions.create(
        model="gpt-4o-mini-2024-07-18",
        max_tokens=512,
        temperature=0.0,
        messages=[
            {"role": "system", "content": "You are the judge of a parliamentary-formatted debate. You will be given a for speech constuctive, an against speech, and then a for speech rebuttal. You must decide a winner based on the strength of each case. and the refutations of the speech"},
            {"role": "user", "content": "Given the following topic: \n" + topic + "\nand given the following for speech constructive: \n" + first_speech_transcription + "\nand given the following against speech: \n" +
             against_speech + "\nand given the following for speech rebuttal: \n"+ second_speech_transcription+'''\nplease decide a winner. You must use traditional parliamentary debate flow procedures. Here are your criteria for deciding a winner: First off, if the negation did not fully refute all of the affirmation's points, the affirmation should win. 
             Secondly, there must be evidence-based warranting for each point brought up on either side of the debate. Evidence can be brought up as statistics OR it can just be a solid link chain from the argument to the impact. Examples, statistics, and quotes from academia all count as evidence.  If there isn't evidence, that point will be weighed less unless it has solid logical backing. 
             Thirdly, there may not be any pre-disposed bias for either side of the debate. Finally, use impact analysis to weigh either side of the debate. Whichever side provides better impacts wins the debate. You measure impacts by how many people it affects. Normally the best impacts tie to either healthcare, environment, or economy. Mention the biggest impact for both sides and why the winning side has a bigger impact. If neither side provides impacts, default to the negation. 
             Either side may bring up impacts implicitly by discussing any sort of implication of the evidence. Give your choice of winner as either the word \"for\" or the word \"against\". This should be the starting word, with no characters before. Following your decision, please give a brief explanation as to why you chose either side. Explain the impact analysis and why the winning side has bigger impacts.'''}
        ]
    )
    return message.choices[0].message.content
