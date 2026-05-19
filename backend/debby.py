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


def _json_from_model(messages, fallback):
    response = client.chat.completions.create(
        model="gpt-4o-mini-2024-07-18",
        max_tokens=700,
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

    return len(re.findall(r"\b[\w']+\b", text)) >= 120


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
        "timer_seconds": 75,
    })

    with open(SPEED_PASSAGES_FILE, 'w', encoding='utf-8') as file:
        json.dump(passages, file, indent=2)


def _cached_speed_drill():
    passages = _load_speed_passages()
    if len(passages) < SPEED_PASSAGE_REUSE_THRESHOLD:
        return None

    drill = dict(random.choice(passages))
    drill['title'] = DRILL_TYPES['speed']
    drill['task'] = "Read the passage aloud, then submit your recording."
    drill['timer_seconds'] = 75
    return drill


def _winner_side_from_rfd(rfd):
    first_word = ((rfd or '').strip().split() or ['unknown'])[0].lower()
    if first_word == 'for':
        return 'aff'
    if first_word == 'against':
        return 'neg'
    return first_word


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
                    "You create compact parliamentary debate flow sheets as JSON. "
                    "Return JSON only with keys: aff_sheet, neg_sheet, ballot, dropped, voters, recommended_drills. "
                    "aff_sheet: max 4 rows. Each row has contention, neg_responses, aff_defense, status, judge_note. "
                    "The aff sheet must flow AFF contention -> NEG responses -> AFF defense. "
                    "neg_sheet: max 4 rows. Each row has contention, aff_rebuttals, status, judge_note. "
                    "The neg sheet must flow NEG contention -> AFF rebuttals. "
                    "contention/responses/rebuttals/defense objects use tag and summary only. "
                    "tag <= 8 words. summary <= 18 words. status must be unrefuted, refuted, or contested. "
                    "Mark a contention unrefuted only when the opposing side did not answer it. "
                    "ballot has aff_unrefuted, neg_unrefuted, winner, explanation. "
                    "Winner must be the side with more unrefuted contentions; if tied, use impact weighing from the RFD. "
                    "ballot winner must be aff or neg; explanation <= 35 words. "
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

    return {
        "aff_sheet": flow.get("aff_sheet", [])[:4] or fallback["aff_sheet"],
        "neg_sheet": flow.get("neg_sheet", [])[:4] or fallback["neg_sheet"],
        "ballot": flow.get("ballot") or fallback["ballot"],
        "dropped": flow.get("dropped", [])[:4],
        "voters": flow.get("voters", [])[:3] or fallback["voters"],
        "recommended_drills": flow.get("recommended_drills", [])[:4],
    }


def generate_drill(drill_type):
    if drill_type not in DRILL_TYPES:
        raise ValueError("Unknown drill type.")

    if drill_type == 'speed':
        cached_drill = _cached_speed_drill()
        if cached_drill:
            return cached_drill

    drill_guidance = {
        'rebuttal': (
            "Create a compact debate argument for the user to rebut. Include a topic, side, "
            "and one paragraph argument with claim, warrant, and impact."
        ),
        'speed': (
            "Create a two-paragraph speed-reading passage about debate, sports, school, "
            "or technology. It should be 220-280 words total, readable aloud, and include "
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
        "prompt": (
            "Schools should require financial literacy because students need practical skills for adulthood. "
            "A student who understands budgets, interest, taxes, and savings can make better decisions before "
            "they face real consequences. These classes would not replace academic subjects; they would connect "
            "school to daily life and help students avoid common financial mistakes.\n\n"
            "The strongest reason is prevention. Many young adults sign loans, open credit cards, or choose jobs "
            "without understanding the long-term tradeoffs. If schools teach these skills early, students can "
            "graduate with more confidence, protect themselves from debt traps, and help their families make "
            "more informed choices."
        ) if drill_type == 'speed' else "Schools should require financial literacy because students need practical skills for adulthood.",
        "task": "Read the passage aloud, then submit your recording." if drill_type == 'speed' else "Give your response aloud, then submit your recording.",
        "timer_seconds": 60 if drill_type != 'speed' else 75,
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
        fallback
    )

    if drill_type == 'speed':
        drill['title'] = DRILL_TYPES['speed']
        drill['task'] = "Read the passage aloud, then submit your recording."
        drill['timer_seconds'] = 75
        if not _looks_like_speed_passage(drill.get('prompt')):
            drill['prompt'] = fallback['prompt']
        _save_speed_passage(drill)
    elif drill_type in {'rebuttal', 'impact'}:
        drill['task'] = "Give your response aloud, then submit your recording."

    return drill


def score_drill(drill_type, drill, response_text):
    if drill_type not in DRILL_TYPES:
        raise ValueError("Unknown drill type.")

    rubric = {
        'rebuttal': "Judge whether the response directly answers the claim, warrant, and impact.",
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
                    "model_answer. Keep feedback concrete and concise."
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
        max_tokens=512,
        temperature=0.0,
        messages=[
            {"role": "system", "content": "You are a negation parliamentary debater by the name of Debby. Your job is to make a debate case and a subsequent negation speech on the topic you are given."},
            {"role": "user", "content": "Given the following topic: \n" + topic + "\nand also given the following affirmative speech: \n" + first_speech_transcription +
                "\nwrite a negation speech in the format of a high school parliamentary debate case that lasts two minutes at average speaking pace, and includes evidence. In the start of your speech, you must say: \"Hello my name is Debby.\""}
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
