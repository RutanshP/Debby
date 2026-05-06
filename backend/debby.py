import os
import csv
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
