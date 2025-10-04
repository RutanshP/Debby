from debby import coin_toss, get_parli_topic, get_mspdp_topic, ai_speech, ai_response, transcribe, winner, load_topics
from parligpt import make_case, make_mspdp_case, case_to_speech, say_case
import os
from flask import Flask, render_template, request, jsonify, send_file
from pymongo import MongoClient
from datetime import datetime
from mutagen.m4a import M4A
import textstat
import speech_recognition as sr
from pydub import AudioSegment
import matplotlib.pyplot as plt
import io
import logging

app = Flask(__name__)

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)
logging.getLogger('matplotlib.font_manager').setLevel(logging.WARNING)

# MongoDB setup
client = MongoClient('mongodb://localhost:27017/')
db = client.debate_db
entries = db.entries

# Load topics at startup
parli_topics, mspdp_topics = load_topics()

@app.route('/log_entry', methods=['POST'])
def log_entry():
    data = request.json
    user_name = data.get('user_name')
    date_time = datetime.strptime(data.get('date_time'), '%Y-%m-%d %H:%M:%S')
    topic = data.get('topic')
    aff_speech = data.get('aff_speech')
    neg_speech = data.get('neg_speech')
    aff_two_speech = data.get('aff_two_speech')
    winner_data = data.get('winner')

    try:
        # Since we are not saving the files, we can't calculate these stats anymore.
        # We can pass the audio duration from the frontend if needed.
        average_wpm = 0
        total_speech_time = "0m0s"

        # Prepare the entry with additional statistics
        entry = {
            'user_name': user_name,
            'date_time': date_time,
            'topic': topic,
            'aff_speech': aff_speech,
            'neg_speech': neg_speech,
            'aff_two_speech': aff_two_speech,
            'winner': winner_data,
            'average_wpm': average_wpm,
            'total_speech_time': total_speech_time
        }

        entries.insert_one(entry)
        logger.info('Debate entry logged successfully.')
        return jsonify({'message': 'Entry logged successfully!'}), 201

    except Exception as e:
        logger.error(f'Error logging entry: {e}')
        return jsonify({'error': 'Error logging entry'}), 500

@app.route('/get_last_five_entries', methods=['GET'])
def get_last_five_entries():
    # Retrieve and sort the most recent 5 entries by date_time in descending order
    entry_list = list(entries.find({}).sort('date_time', -1).limit(5))
    
    for entry in entry_list:
        entry['_id'] = str(entry['_id'])  # Convert ObjectId to string for JSON serialization
        entry['date_time'] = entry['date_time'].strftime('%Y-%m-%d %H:%M:%S')  # Format datetime for display
    
    return jsonify({'entry_list': entry_list})

@app.route('/speech-statistics', methods=['POST'])
def speech_statistics():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    
    audio_file = request.files['audio']
    transcript_text = request.form.get('transcript')

    try:
        audio = AudioSegment.from_file(audio_file)
        length_in_seconds = len(audio) / 1000.0
        word_count = textstat.lexicon_count(transcript_text, removepunct=True)
        length_in_minutes = float(length_in_seconds / 60)
        wpm = word_count / length_in_minutes if length_in_minutes > 0 else 0

        return jsonify({'average_wpm': wpm, 'word_count': word_count})
    except Exception as e:
        logger.error(f"Error calculating speech statistics: {e}")
        return jsonify({'error': 'Could not calculate speech statistics'}), 500

@app.route('/wpm-plot', methods=['POST'])
def wpm_plot():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
        
    audio_file = request.files['audio']
    plt.switch_backend('Agg')

    try:
        recognizer = sr.Recognizer()
        audio = AudioSegment.from_file(audio_file)
        chunk_length_ms = 5000
        chunks = [audio[i:i + chunk_length_ms] for i in range(0, len(audio), chunk_length_ms)]
        
        transcripts = []
        for i, chunk in enumerate(chunks):
            chunk_io = io.BytesIO()
            chunk.export(chunk_io, format="wav")
            chunk_io.seek(0)
            with sr.AudioFile(chunk_io) as source:
                audio_data = recognizer.record(source)
                try:
                    text = recognizer.recognize_google(audio_data)
                    transcripts.append((i * 5, text))
                except sr.UnknownValueError:
                    transcripts.append((i * 5, ""))
        
        wpm_data = []
        for time, text in transcripts:
            word_count = len(text.split())
            words_per_minute = (word_count / 5) * 60
            wpm_data.append((time, words_per_minute))

        times = [time for time, wpm in wpm_data]
        wpms = [wpm for time, wpm in wpm_data]

        adjusted_wpms = []
        for element in wpms:
            if element == 0:
                if len(adjusted_wpms) > 0:
                    avg_wpm = sum(adjusted_wpms) / len(adjusted_wpms)
                    adjusted_wpms.append(avg_wpm)
                else:
                    adjusted_wpms.append(0)
            else:
                adjusted_wpms.append(element)

        plt.figure()
        plt.plot(times, adjusted_wpms, marker='o')
        plt.title('Words Per Minute Over Time')
        plt.xlabel('Time (s)')
        plt.ylabel('WPM')
        plt.grid(True)
        img = io.BytesIO()
        plt.savefig(img, format='png')
        img.seek(0)
        plt.close()
        return send_file(img, mimetype='image/png')

    except Exception as e:
        logger.error(f"Error generating WPM plot: {e}")
        return jsonify({'error': 'Could not generate WPM plot'}), 500

@app.route('/get_entry/<date_time_str>', methods=['GET'])
def get_entry(date_time_str):
    try:
        date_time = datetime.strptime(date_time_str, '%Y-%m-%d %H:%M:%S')
        entry = entries.find_one({'date_time': date_time})
        
        if entry:
            entry['_id'] = str(entry['_id'])
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
    
    audio_file = request.files['audio']
    topic = request.form.get('topic')
    speech_type = request.form.get('speech_type')

    if not topic:
        return jsonify({'error': 'No topic provided'}), 400

    try:
        # Use an in-memory buffer instead of saving to disk
        audio_buffer = io.BytesIO(audio_file.read())
        audio_buffer.name = audio_file.filename or 'audio.m4a'

        transcription = transcribe(audio_buffer)

        if speech_type == 'first':
            ai_speech_text = ai_response(topic, transcription)
            return jsonify({
                'first_speech_transcription': transcription,
                'aiSpeech': ai_speech_text
            })
        elif speech_type == 'second':
            first_speech_transcription = request.form.get('first_speech_transcription')
            ai_speech_text = request.form.get('ai_speech')
            
            if not first_speech_transcription or not ai_speech_text:
                return jsonify({'error': 'Missing first speech or AI response'}), 400

            winner_text = winner(first_speech_transcription, ai_speech_text, transcription, topic)
            return jsonify({
                'second_speech_transcription': transcription,
                'result': winner_text
            })
        else:
            return jsonify({'error': 'Invalid speech type'}), 400

    except Exception as e:
        logger.error(f"Error processing recording: {e}")
        return jsonify({'error': 'Failed to process recording'}), 500

@app.route('/generate-case', methods=['GET'])
def generate_case():
    format_type = request.args.get('format')
    side = request.args.get('side') == "affirmative"
    topic = request.args.get('topic')
    
    if format_type == 'mspdp':
        case = make_mspdp_case(topic=topic, side=side)
    else:
        case = make_case(topic=topic, side=side)
    return jsonify({'case': case})

@app.route('/random-generate-case', methods=['GET'])
def random_generate_case():
    format_type = request.args.get('format')
    speed = request.args.get('speed')
    topic = request.args.get('topic')
    side = 'affirmative' if coin_toss() else 'negation'
    
    if format_type == 'mspdp':
        case = make_mspdp_case(topic=topic, side=(side=='affirmative'))
    else:
        case = make_case(topic=topic, side=(side=='affirmative'))
    speech = case_to_speech(case)
    say_case(speech=speech, speed=speed)
    return jsonify({'case': case})

@app.route('/get-topic', methods=['GET'])
def fetch_topic():
    debate_type = request.args.get('debateType')
    tournament = request.args.get('tournament')
    custom_topic = request.args.get('customTopic')

    if custom_topic:
        topic = custom_topic
    elif debate_type == "Parli":
        topic = get_parli_topic(parli_topics, tournament=tournament)
    else:
        topic = get_mspdp_topic(mspdp_topics)

    return jsonify({'topic': topic})

@app.route('/view_entries', methods=['GET'])
def view_entries():
    all_entries = list(entries.find({}).sort('date_time', -1))
    
    user_wins = 0
    debby_wins = 0

    for entry in all_entries:
        entry['_id'] = str(entry['_id'])
        entry['date_time'] = entry['date_time'].strftime('%Y-%m-%d %H:%M:%S')
        winner_data = entry.get('winner')

        if winner_data:
            first_word = winner_data.split()[0].strip().lower()
            if first_word == 'for':
                user_wins += 1
            elif first_word == 'against':
                debby_wins += 1
        else:
            entry['winner'] = "Not available"

    total_entries = len(all_entries)
    return render_template('view_entries.html', entries=all_entries, total_entries=total_entries, user_wins=user_wins, debby_wins=debby_wins)

if __name__ == '__main__':
    app.run(port=8000, debug=True)
