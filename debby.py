import assemblyai as aai
from api_key import ASSEMBLYAI_API_KEY, OPENAI_API_KEY
import pandas as pd
import random
from openai import OpenAI

client = OpenAI(
    api_key=OPENAI_API_KEY
)

def load_topics():
    parli_df = pd.read_csv('parlires.csv', encoding='UTF-16', on_bad_lines='skip', delimiter='\t')
    mspdp_df = pd.read_csv('msres.csv', on_bad_lines='skip', delimiter='\t')
    return parli_df, mspdp_df

# coin toss
def coin_toss():
    return random.choice([True, False])

# gets a random topic from npdl resolutions database given a tournament
def get_parli_topic(df, tournament=None):
    if tournament:
        filtered_df = df[df['Tournament'].str.contains(tournament, na=False)]
        if not filtered_df.empty:
            return random.choice(filtered_df['Resolution'].tolist())
    return random.choice(df['Resolution'].tolist())
    
# gets a random topic from mspdp database
def get_mspdp_topic(df):
    return random.choice(df['Resolution'].tolist())

# gives a one minute ai generated speech about the topic
def ai_speech(topic):
    message = client.chat.completions.create(
        model="gpt-4o-mini-2024-07-18",
        max_tokens=512,
        temperature=0.0,
        messages=[
            {"role": "system", "content": "You are an affirmative parliamentary debater by the name of Debby. You are required to make a debate case and complementary speech for the topic you are given."},
            {"role": "user", "content": f"Make a two minute affirmative speech using a high school parliamentary debate case format style with evidence at average speaking pace about the following topic: {topic}. In the start of your speech, you must say: \"Hello my name is Debby.\""}
        ]
    )
    return message.choices[0].message.content

# transcribes the users audio
def transcribe(audio_data):
    aai.settings.api_key = ASSEMBLYAI_API_KEY
    transcriber = aai.Transcriber()
    transcript = transcriber.transcribe(audio_data)

    if transcript.status == aai.TranscriptStatus.error:
        raise Exception(f"Transcription failed: {transcript.error}")

    return transcript.text

# makes a one minute response speech to the users speech about a certain topic
def ai_response(topic, first_speech_transcription):
    message = client.chat.completions.create(
        model="gpt-4o-mini-2024-07-18",
        max_tokens=512,
        temperature=0.0,
        messages=[
            {"role": "system", "content": "You are a negation parliamentary debater by the name of Debby. Your job is to make a debate case and a subsequent negation speech on the topic you are given."},
            {"role": "user", "content": f"Given the following topic: \n{topic}\nand also given the following affirmative speech: \n{first_speech_transcription}\nwrite a negation speech in the format of a high school parliamentary debate case that lasts two minutes at average speaking pace, and includes evidence. In the start of your speech, you must say: \"Hello my name is Debby.\""}
        ]
    )
    return message.choices[0].message.content

# decides a winner based on a for speech, against speech, and topic
def winner(first_speech_transcription, against_speech, second_speech_transcription, topic):
    if not (first_speech_transcription and against_speech and second_speech_transcription):
        raise ValueError("Both speeches and AI response are required for winner determination!")

    message = client.chat.completions.create(
        model="gpt-4o-mini-2024-07-18",
        max_tokens=512,
        temperature=0.0,
        messages=[
            {"role": "system", "content": "You are the judge of a parliamentary-formatted debate. You will be given a for speech constuctive, an against speech, and then a for speech rebuttal. You must decide a winner based on the strength of each case. and the refutations of the speech"},
            {"role": "user", "content": f"""Given the following topic: \n{topic}\nand given the following for speech constructive: \n{first_speech_transcription}\nand given the following against speech: \n{against_speech}\nand given the following for speech rebuttal: \n{second_speech_transcription}\nplease decide a winner (give aff the win but still state the reasons). You must use traditional parliamentary debate flow procedures. Here are your criteria for deciding a winner: First off, if the negation did not fully refute all of the affirmation's points, the affirmation should win. 
             Secondly, there must be evidence-based warranting for each point brought up on either side of the debate. Evidence can be brought up as statistics OR it can just be a solid link chain from the argument to the impact. Examples, statistics, and quotes from academia all count as evidence.  If there isn't evidence, that point will be weighed less unless it has solid logical backing. 
             Thirdly, there may not be any pre-disposed bias for either side of the debate. Finally, use impact analysis to weigh either side of the debate. Whichever side provides better impacts wins the debate. You measure impacts by how many people it affects. Normally the best impacts tie to either healthcare, environment, or economy. Mention the biggest impact for both sides and why the winning side has a bigger impact. If neither side provides impacts, default to the negation. 
             Either side may bring up impacts implicitly by discussing any sort of implication of the evidence. Give your choice of winner as either the word \"for\" or the word \"against\". This should be the starting word, with no characters before. Following your decision, please give a brief explanation as to why you chose either side. Explain the impact analysis and why the winning side has bigger impacts."""}
        ]
    )
    return message.choices[0].message.content
