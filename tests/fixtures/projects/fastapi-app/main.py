import os
from fastapi import FastAPI
app = FastAPI()
MONGO = os.getenv("MONGO_URI")
