from backend.app import app


if __name__ == '__main__':
    print("Starting Debby at http://127.0.0.1:8000", flush=True)
    app.run(host='127.0.0.1', port=8000, debug=False, use_reloader=False)
