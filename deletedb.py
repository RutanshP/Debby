from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/')  # Adjust the URI as needed
db = client['debate_db']

for collection_name in db.list_collection_names():
    db[collection_name].drop()