from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/')
db = client['debate_db']
collection = db['entries']

for document in collection.find():
    print(document)