from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/', serverSelectionTimeoutMS=2000)
db = client['debate_db']

for collection_name in db.list_collection_names():
    db[collection_name].drop()
