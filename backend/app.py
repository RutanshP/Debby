import os
import json

os.environ.setdefault("MPLCONFIGDIR", os.path.join(os.getcwd(), ".matplotlib_cache"))

from dotenv import load_dotenv
from .debby import coin_toss, get_parli_topic, get_mspdp_topic, ai_speech, ai_response, transcribe, winner
from .parligpt import make_case, make_mspdp_case, case_to_speech, say_case
from flask import Flask, render_template, request, jsonify, send_file, Response
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from datetime import datetime
from mutagen.m4a import M4A
import textstat
import speech_recognition as sr
from pydub import AudioSegment
import matplotlib.pyplot as plt
import io
import math
import logging

try:
    import imageio_ffmpeg
    AudioSegment.converter = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    pass

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR = os.path.join(BASE_DIR, 'data')
AUDIO_DIR = os.path.join(DATA_DIR, 'audio')

load_dotenv(os.path.join(BASE_DIR, '.env'))
os.makedirs(AUDIO_DIR, exist_ok=True)

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, 'templates'),
    static_folder=os.path.join(BASE_DIR, 'static'),
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logging.getLogger('matplotlib.font_manager').setLevel(logging.WARNING)
APP_PASSWORD = os.getenv("APP_PASSWORD")

# MongoDB setup
client = MongoClient(
    os.getenv("MONGO_URI", "mongodb://localhost:27017/"),
    serverSelectionTimeoutMS=2000,
    connectTimeoutMS=2000,
    socketTimeoutMS=2000,
)
db = client.debate_db
entries = db.entries
LOCAL_ENTRIES_FILE = os.path.join(DATA_DIR, 'debate_entries.json')


@app.before_request
def require_app_password():
    if not APP_PASSWORD:
        return None

    auth = request.authorization
    if auth and auth.password == APP_PASSWORD:
        return None

    return Response(
        "Authentication required",
        401,
        {"WWW-Authenticate": 'Basic realm="DebbyAI"'}
    )

    
first_speech_transcription = None
second_speech_transcription = None
first_speech_words = []
second_speech_words = []

# File path variables for first and second speeches
first_speech_file_path = os.path.join(AUDIO_DIR, 'first_speech.webm')
second_speech_file_path = os.path.join(AUDIO_DIR, 'second_speech.webm')


def format_entry(entry):
    formatted = dict(entry)
    if '_id' in formatted:
        formatted['_id'] = str(formatted['_id'])
    date_time = formatted.get('date_time')
    if isinstance(date_time, datetime):
        formatted['date_time'] = date_time.strftime('%Y-%m-%d %H:%M:%S')
    return formatted


def load_local_entries():
    if not os.path.exists(LOCAL_ENTRIES_FILE):
        return []

    with open(LOCAL_ENTRIES_FILE, encoding='utf-8') as file:
        saved_entries = json.load(file)

    loaded_entries = []
    for entry in saved_entries:
        loaded_entry = dict(entry)
        date_time = loaded_entry.get('date_time')
        if isinstance(date_time, str):
            loaded_entry['date_time'] = datetime.strptime(date_time, '%Y-%m-%d %H:%M:%S')
        loaded_entries.append(loaded_entry)
    return loaded_entries


def save_local_entry(entry):
    saved_entries = [format_entry(saved_entry) for saved_entry in load_local_entries()]
    local_entry = format_entry(entry)
    local_entry['_id'] = local_entry.get('_id') or f"local-{datetime.now().timestamp()}"
    saved_entries.append(local_entry)

    with open(LOCAL_ENTRIES_FILE, 'w', encoding='utf-8') as file:
        json.dump(saved_entries, file, indent=2)


def insert_entry(entry):
    try:
        entries.insert_one(dict(entry))
        logger.info('Debate entry logged successfully to MongoDB.')
        return 'MongoDB'
    except PyMongoError as e:
        logger.warning(f'MongoDB unavailable; saving entry locally instead: {e}')
        save_local_entry(entry)
        logger.info('Debate entry logged successfully to local JSON.')
        return 'local JSON'


def get_entries(limit=None):
    try:
        cursor = entries.find({}).sort('date_time', -1)
        if limit:
            cursor = cursor.limit(limit)
        return [format_entry(entry) for entry in cursor]
    except PyMongoError as e:
        logger.warning(f'MongoDB unavailable; reading entries from local JSON instead: {e}')
        local_entries = sorted(load_local_entries(), key=lambda entry: entry.get('date_time'), reverse=True)
        if limit:
            local_entries = local_entries[:limit]
        return [format_entry(entry) for entry in local_entries]


def get_entry_by_date_time(date_time):
    try:
        entry = entries.find_one({'date_time': date_time})
        return format_entry(entry) if entry else None
    except PyMongoError as e:
        logger.warning(f'MongoDB unavailable; reading entry from local JSON instead: {e}')
        for entry in load_local_entries():
            if entry.get('date_time') == date_time:
                return format_entry(entry)
        return None


def transcript_word_count(transcript):
    return textstat.lexicon_count(transcript or '', removepunct=True)


def calculate_average_wpm(file_path, transcript):
    audio = AudioSegment.from_file(file_path)
    duration_minutes = max((len(audio) / 1000.0) / 60, 1 / 60)
    return round(transcript_word_count(transcript) / duration_minutes)


def calculate_wpm_series(file_path, words, interval=5):
    audio = AudioSegment.from_file(file_path)
    duration_seconds = max(len(audio) / 1000.0, 1)
    bucket_count = max(math.ceil(duration_seconds / interval), 1)
    buckets = [0] * bucket_count

    for word in words or []:
        start_ms = word.get('start')
        if start_ms is None:
            continue

        bucket_index = min(int((start_ms / 1000.0) // interval), bucket_count - 1)
        buckets[bucket_index] += 1

    series = []
    for index, word_count in enumerate(buckets):
        start_second = index * interval
        end_second = min(start_second + interval, duration_seconds)
        bucket_seconds = max(end_second - start_second, 1)
        series.append({
            'time': start_second,
            'wpm': round((word_count / bucket_seconds) * 60)
        })

    return series


def get_speech_stats():
    first_wpm = calculate_average_wpm(first_speech_file_path, first_speech_transcription) if first_speech_transcription else 0
    second_wpm = calculate_average_wpm(second_speech_file_path, second_speech_transcription) if second_speech_transcription else 0
    completed_wpms = [wpm for wpm in (first_wpm, second_wpm) if wpm > 0]
    average_wpm = round(sum(completed_wpms) / len(completed_wpms)) if completed_wpms else 0

    return {
        'first_speech_wpm': first_wpm,
        'second_speech_wpm': second_wpm,
        'average_wpm': average_wpm,
        'first_speech_word_count': transcript_word_count(first_speech_transcription),
        'second_speech_word_count': transcript_word_count(second_speech_transcription),
        'first_speech_duration': calculate_total_time(first_speech_file_path) if os.path.exists(first_speech_file_path) else '0m0s',
        'second_speech_duration': calculate_total_time(second_speech_file_path) if os.path.exists(second_speech_file_path) else '0m0s',
    }


@app.route('/log_entry', methods=['POST'])
def log_entry():
    data = request.json
    user_name = data.get('user_name')
    date_time = datetime.strptime(data.get('date_time'), '%Y-%m-%d %H:%M:%S')
    topic = data.get('topic')
    print('bob'+topic)
    aff_speech = data.get('aff_speech')
    print(aff_speech)
    neg_speech = data.get('neg_speech')
    aff_two_speech = data.get('aff_two_speech')
    print(aff_two_speech)
    winner = data.get('winner')

    try:
        stats = get_speech_stats()
        total_speech_time = calculate_total_time(first_speech_file_path)+ calculate_total_time(second_speech_file_path)

        # Prepare the entry with additional statistics
        entry = {
            'user_name': user_name,
            'date_time': date_time,
            'topic': topic,
            'aff_speech': aff_speech,
            'neg_speech': neg_speech,
            'aff_two_speech': aff_two_speech,
            'winner': winner,
            'first_speech_wpm': int(stats['first_speech_wpm']),
            'second_speech_wpm': int(stats['second_speech_wpm']),
            'average_wpm': int(stats['average_wpm']),
            'total_speech_time': total_speech_time
        }

        storage = insert_entry(entry)
        return jsonify({'message': f'Entry logged successfully to {storage}!'}), 201

    except Exception as e:
        logger.error(f'Error logging entry: {e}')
        return jsonify({'error': 'Error logging entry'}), 500

def calculate_total_time(file_path):
    total_time = len(AudioSegment.from_file(file_path)) / 1000.0  # Total time in seconds
    return str(int(total_time / 60)) + 'm' + str(int(total_time % 60)) + 's'


@app.route('/get_last_five_entries', methods=['GET'])
def get_last_five_entries():
    entry_list = get_entries(limit=5)
    return jsonify({'entry_list': entry_list})

@app.route('/speech-statistics', methods=['GET'])
def speech_statistics():
    return jsonify(get_speech_stats())

@app.route('/wpm-plot', methods=['GET'])
def wpm_plot():
    plt.switch_backend('Agg')

    def plot_wpm(first_series, second_series):
        plt.figure(figsize=(6, 3.6))
        if first_series:
            plt.plot(
                [point['time'] for point in first_series],
                [point['wpm'] for point in first_series],
                marker='o',
                label='First speech'
            )
        if second_series:
            plt.plot(
                [point['time'] for point in second_series],
                [point['wpm'] for point in second_series],
                marker='o',
                label='Second speech'
            )

        plt.title('Words Per Minute Over Time')
        plt.xlabel('Time (s)')
        plt.ylabel('WPM')
        plt.grid(True)
        if first_series or second_series:
            plt.legend()
        plt.tight_layout()
        img = io.BytesIO()
        plt.savefig(img, format='png')
        img.seek(0)
        plt.close()
        return img


    first_series = calculate_wpm_series(first_speech_file_path, first_speech_words) if first_speech_words else []
    second_series = calculate_wpm_series(second_speech_file_path, second_speech_words) if second_speech_words else []
    return send_file(plot_wpm(first_series, second_series), mimetype='image/png')

@app.route('/get_entry/<date_time_str>', methods=['GET'])
def get_entry(date_time_str):
    try:
        date_time = datetime.strptime(date_time_str, '%Y-%m-%d %H:%M:%S')
        entry = get_entry_by_date_time(date_time)
        
        if entry:
            return jsonify(entry), 200
        else:
            return jsonify({"error": "Entry not found!"}), 404
            
    except ValueError:
        return jsonify({"error": "Invalid date_time format. Use 'YYYY-MM-DD HH:MM:SS'."}), 400

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/parli-gpt')
def parli_gpt():
    return render_template('parli_gpt.html')

@app.route('/flowbot')
def flowbot():
    return render_template('flowbot.html')

@app.route('/home', methods=['POST', 'GET'])
def home():
    return render_template('index.html')

@app.route('/process-recording', methods=['POST'])
def process_recording():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    audio = request.files['audio']
    if audio.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    # Determine which speech is being recorded (first or second)
    speech_type = request.form.get('speech_type')  # 'first' or 'second'
    
    if speech_type == 'first':
        audio_path = first_speech_file_path
        audio.save(audio_path)
        
        try:
            # Process and transcribe the first speech
            global first_speech_transcription
            global first_speech_words
            first_speech_transcription, first_speech_words = transcribe(audio_path, include_words=True)
            print("First speech transcription:", first_speech_transcription)  # For debugging
            bob = first_speech_transcription
            
            print("Debate topic:", topic)  # Debugging log

            # Get AI response (Debby's response)
            global aiSpeech
            aiSpeech = ai_response(topic, first_speech_transcription)
            print("AI response (Debby's response):", aiSpeech)  # Debugging log

            return jsonify({
                'message': 'First speech recorded. AI has responded.',
                'first_speech_transcription': first_speech_transcription,
                'aiSpeech': aiSpeech,
                'topic': topic
            })
        except Exception as e:
            return jsonify({'error': f'Error processing first speech: {str(e)}'}), 500
    
    elif speech_type == 'second':
        audio_path = second_speech_file_path
        audio.save(audio_path)
        
        try:
            # Process and transcribe the second speech
            global second_speech_transcription
            global second_speech_words
            second_speech_transcription, second_speech_words = transcribe(audio_path, include_words=True)
            print("Second speech transcription:", second_speech_transcription)  # For debugging

            # Ensure the first speech and AI response are available before determining winner
            if not first_speech_transcription or not aiSpeech:
                return jsonify({'error': 'First speech or AI response is missing. Cannot determine the winner.'}), 400

            # Determine the winner
            result = winner(first_speech_transcription, aiSpeech, second_speech_transcription, topic,)
            print("Winner result:", result)  # Debugging log

            return jsonify({
                'message': 'Second speech recorded. Winner has been determined.',
                'second_speech_transcription': second_speech_transcription,
                'winner': result,
                'result': result
            })
        except Exception as e:
            return jsonify({'error': f'Error processing second speech: {str(e)}'}), 500
    
    else:
        return jsonify({'error': 'Invalid speech type provided'}), 400

@app.route('/generate-case', methods=['GET'])
def generate_case():
    format = request.args.get('format')
    side = request.args.get('side')
    if side == "affirmative":
        side = True
    else:
        side = False
    topic = request.args.get('topic')
    if format == 'mspdp':
        case = make_mspdp_case(topic=topic, side=side)
    else:
        case = make_case(topic=topic, side=side)
    return jsonify({'case': case})

@app.route('/random-generate-case', methods=['GET'])
def random_generate_case():
    format = request.args.get('format')
    speed = request.args.get('speed')
    topic = request.args.get('topic')
    side = coin_toss
    if side == 0:
        side = 'affirmative'
    else:
        side = 'negation'
    
    if format == 'mspdp':
        case = make_mspdp_case(topic=topic, side=side)
    else:
        case = make_case(topic=topic, side=side)
    speech = case_to_speech(case)
    say_case(speech=speech, speed=speed)
    return jsonify({'case': case})

@app.route('/get-topic', methods=['GET'])
def fetch_topic():
    global topic
    debate_type = request.args.get('debateType')
    tournament = request.args.get('tournament')
    custom_topic = request.args.get('customTopic')

    if custom_topic:
        topic = custom_topic
    elif debate_type == "Parli":
        topic = get_parli_topic(tournament=tournament)
    else:
        topic = get_mspdp_topic()

    return jsonify({'topic': topic})

@app.route('/get-ai-speech', methods=['GET'])
def get_ai_speech():
    global first_speech_transcription
    global first_speech_words
    global aiSpeech
    # Get the file path dynamically from the request or use a default value
    file_path = request.args.get('file_path', first_speech_file_path)
    
    # Transcribe the provided recording file
    first_speech_transcription, first_speech_words = transcribe(file_path, include_words=True)
    
    # Generate AI's response using the transcription
    aiSpeech = ai_response(topic, first_speech_transcription)
    
    # Return the transcription and AI response as JSON
    return jsonify({'first_speech_transcription': first_speech_transcription, 'aiSpeech': aiSpeech })

@app.route('/get-winner', methods=['GET'])
def get_winner():
    global second_speech_transcription
    global second_speech_words
    file2path = request.args.get('file2path', second_speech_file_path)
    
    # Transcribe the provided recording file
    second_speech_transcription, second_speech_words = transcribe(file2path, include_words=True)
    # Check if both speeches and AI response are available
    if not (first_speech_transcription and aiSpeech and second_speech_transcription):
        error_message = 'Both speeches and AI response are required for winner determination!'
        app.logger.error(error_message)  # Log the error message
        return jsonify({'error': error_message}), 400
    
    # If everything is available, determine the winner
    try:
        win = winner(first_speech_transcription, aiSpeech, second_speech_transcription, topic)
        return jsonify({'second_speech_transcription': second_speech_transcription, 'winner': win})
    except Exception as e:
        app.logger.error(f"Error determining winner: {e}")
        return jsonify({'error': 'An error occurred while determining the winner.'}), 500

def reset_speech_data():
    global second_speech_transcription
    global first_speech_transcription
    global first_speech_words
    global second_speech_words
    global aiSpeech
    global topic

    second_speech_transcription = None
    first_speech_transcription = None
    first_speech_words = []
    second_speech_words = []
    aiSpeech = None
    topic = None

@app.route('/view_entries', methods=['GET'])
def view_entries():
    all_entries = get_entries()
    
    user_wins = 0
    debby_wins = 0

    for entry in all_entries:
        winner = entry.get('winner')  # Get the 'winner' field from the entry

        if winner is None:
            entry['winner'] = "Not available"  # Set to 'Not available' if winner is None
        else:
            # Split the winner string by spaces and normalize the first word
            first_word = winner.split()[0].strip().lower()  # Get the first word and normalize it
            print(first_word)

            # Check who won based on the first word of the 'winner' field
            if first_word == 'for':
                user_wins += 1
            elif first_word == 'against':
                debby_wins += 1

    # After iterating over all entries, calculate the total
    total_entries = len(all_entries)

    print(f"User Wins: {user_wins}")
    print(f"Debby's Wins: {debby_wins}")

    # Render the results in the view_entries.html template
    return render_template('view_entries.html', entries=all_entries, total_entries=total_entries, user_wins=user_wins, debby_wins=debby_wins)

