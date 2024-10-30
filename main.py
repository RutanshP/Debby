from debby import coin_toss, get_parli_topic, get_mspdp_topic, ai_speech, ai_response, transcribe, winner
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
import numpy as np
import io
import base64
import logging

app = Flask(__name__)

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)
logging.getLogger('matplotlib.font_manager').setLevel(logging.WARNING)

# MongoDB setup
client = MongoClient('mongodb://localhost:27017/')
db = client.debate_db
entries = db.entries

    
first_speech_transcription = None
second_speech_transcription = None

# File path variables for first and second speeches
first_speech_file_path = 'path/to/save/first_speech.wav'
second_speech_file_path = 'path/to/save/second_speech.wav'


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
        # Calculate average WPM and total speech time
        average_wpm = (calculate_wpm('first_speech.m4a') + calculate_wpm('second_speech.m4a'))/2 # Adjust to your function name
        total_speech_time = calculate_total_time('first_speech.m4a')+ calculate_total_time('second_speech.m4a')  # Adjust to your function name

        # Prepare the entry with additional statistics
        entry = {
            'user_name': user_name,
            'date_time': date_time,
            'topic': topic,
            'aff_speech': aff_speech,
            'neg_speech': neg_speech,
            'aff_two_speech': aff_two_speech,
            'winner': winner,
            'average_wpm': average_wpm,
            'total_speech_time': total_speech_time
        }

        entries.insert_one(entry)
        logger.info('Debate entry logged successfully.')
        return jsonify({'message': 'Entry logged successfully!'}), 201

    except Exception as e:
        logger.error(f'Error logging entry: {e}')
        return jsonify({'error': 'Error logging entry'}), 500

# Define your helper functions outside the log_entry function
def calculate_wpm(file_path): 
    audio = AudioSegment.from_file(file_path)
    length_in_seconds = len(audio) / 1000.0
    global first_speech_transcription
    word_count = textstat.lexicon_count(first_speech_transcription, removepunct=True)
    length = float(length_in_seconds / 60)
    return word_count / length if length > 0 else 0

def calculate_total_time(file_path):
    total_time = len(AudioSegment.from_file(file_path)) / 1000.0  # Total time in seconds
    return str(int(total_time / 60)) + 'm' + str(int(total_time % 60)) + 's'


@app.route('/get_last_five_entries', methods=['GET'])
def get_last_five_entries():
    # Retrieve and sort the most recent 5 entries by date_time in descending order
    entry_list = list(entries.find({}).sort('date_time', -1).limit(5))
    
    for entry in entry_list:
        entry['_id'] = str(entry['_id'])  # Convert ObjectId to string for JSON serialization
        entry['date_time'] = entry['date_time'].strftime('%Y-%m-%d %H:%M:%S')  # Format datetime for display
    
    return jsonify({'entry_list': entry_list})

@app.route('/speech-statistics', methods=['GET'])
def speech_statistics():

    def wpm(file_path):
        audio = AudioSegment.from_file(file_path)
        length_in_seconds = len(audio) / 1000.0  # pydub uses milliseconds
        global first_speech_transcription
        word_count = textstat.lexicon_count(first_speech_transcription, removepunct=True)
        length = float(length_in_seconds / 60)
        wpm = word_count / length
        return wpm

    def word_count():
        global first_speech_transcription
        word_count = textstat.lexicon_count(first_speech_transcription, removepunct=True)
        return word_count

    # Assume the file path is passed as a query parameter (or change it accordingly)
    file_path = request.args.get('file_path', 'first_speech.m4a')
    
    return jsonify({'average_wpm' : wpm(file_path), 'word_count' : word_count()})

@app.route('/wpm-plot', methods=['GET'])
def wpm_plot():
    plt.switch_backend('Agg')

    def transcribe_audio(file_path):
        recognizer = sr.Recognizer()
        audio = AudioSegment.from_file(file_path)
        chunk_length_ms = 5000
        chunks = [audio[i:i + chunk_length_ms] for i in range(0, len(audio), chunk_length_ms)]
        
        transcripts = []
        for i, chunk in enumerate(chunks):
            chunk.export("temp_chunk.wav", format="wav")
            with sr.AudioFile("temp_chunk.wav") as source:
                audio_data = recognizer.record(source)
                try:
                    text = recognizer.recognize_google(audio_data)
                    transcripts.append((i * 5, text))
                except sr.UnknownValueError:
                    transcripts.append((i * 5, ""))  # Store empty text for unrecognized segments
        
        return transcripts

    def calculate_wpm(transcripts, interval=5):
        wpm = []
        for time, text in transcripts:
            word_count = len(text.split())
            words_per_minute = (word_count / interval) * 60  # Convert to WPM
            wpm.append((time, words_per_minute))
        
        return wpm

    def plot_wpm(wpm_data):
        times = [time for time, wpm in wpm_data]
        wpms = [wpm for time, wpm in wpm_data]

        # Create a new list to hold adjusted WPM values
        adjusted_wpms = []
        
        for element in wpms:
            if element == 0:
                # If the current WPM is 0, calculate the average of the adjusted wpms
                if len(adjusted_wpms) > 0:  # Ensure there are values to calculate the average
                    avg_wpm = sum(adjusted_wpms) / len(adjusted_wpms)
                    adjusted_wpms.append(avg_wpm)  # Replace the 0 with the average
                else:
                    adjusted_wpms.append(0)  # If no previous values, just append 0
            else:
                adjusted_wpms.append(element)  # Otherwise, just append the current element

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
        return img


    # Dynamic file path for WPM plot, assume it's passed as a query parameter
    file_path = request.args.get('file_path', 'first_speech.m4a')
    transcripts = transcribe_audio(file_path)
    wpm_data = calculate_wpm(transcripts)
    return send_file(plot_wpm(wpm_data=wpm_data), mimetype='image/png')

@app.route('/get_entry/<date_time_str>', methods=['GET'])
def get_entry(date_time_str):
    try:
        date_time = datetime.strptime(date_time_str, '%Y-%m-%d %H:%M:%S')
        entry = entries.find_one({'date_time': date_time})
        
        if entry:
            entry['_id'] = str(entry['_id'])  # Convert ObjectId to string for JSON serialization
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
        audio_path = 'first_speech.m4a'
        audio.save(audio_path)
        
        try:
            # Process and transcribe the first speech
            global first_speech_transcription
            first_speech_transcription = transcribe(audio_path)  # Transcribe and save the first speech
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
        audio_path = 'second_speech.m4a'
        audio.save(audio_path)
        
        try:
            # Process and transcribe the second speech
            global second_speech_transcription
            second_speech_transcription = transcribe(audio_path)  # Transcribe and save the second speech
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
    global aiSpeech
    # Get the file path dynamically from the request or use a default value
    file_path = request.args.get('file_path', 'first_speech.m4a')
    
    # Transcribe the provided recording file
    first_speech_transcription = transcribe(file_path)
    
    # Generate AI's response using the transcription
    aiSpeech = ai_response(topic, first_speech_transcription)
    
    # Return the transcription and AI response as JSON
    return jsonify({'first_speech_transcription': first_speech_transcription, 'aiSpeech': aiSpeech })

@app.route('/get-winner', methods=['GET'])
def get_winner():
    file2path = request.args.get('file2path', 'second_speech.m4a')
    
    # Transcribe the provided recording file
    second_speech_transcription = transcribe(file2path)
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
    global aiSpeech
    global topic

    second_speech_transcription = None
    first_speech_transcription = None
    aiSpeech = None
    topic = None

@app.route('/view_entries', methods=['GET'])
def view_entries():
    # Retrieve and sort all entries by date_time in descending order
    all_entries = list(entries.find({}).sort('date_time', -1))
    
    user_wins = 0
    debby_wins = 0

    for entry in all_entries:
        entry['_id'] = str(entry['_id'])  # Convert ObjectId to string for JSON serialization
        entry['date_time'] = entry['date_time'].strftime('%Y-%m-%d %H:%M:%S')  # Format datetime for display
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



if __name__ == '__main__':
    app.run(port=8000, debug=True)
