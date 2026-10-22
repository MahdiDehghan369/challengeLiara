import os
from flask import Flask
app = Flask(__name__)
key = os.environ.get("REDIS_URL")
app.run(host="0.0.0.0", port=5000)
