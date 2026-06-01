"""
High School Management System API

A super simple FastAPI application that allows students to view and sign up
for extracurricular activities at Mergington High School.

Also includes a full-featured Todo/Memo desktop-style app with reminders,
time tracking, progress tracking, and tag-based categorisation.
"""

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import uuid
import os
from pathlib import Path

app = FastAPI(title="Mergington High School API",
              description="API for viewing and signing up for extracurricular activities")

# Mount the static files directory
current_dir = Path(__file__).parent
app.mount("/static", StaticFiles(directory=os.path.join(Path(__file__).parent,
          "static")), name="static")

# In-memory activity database
activities = {
    "Chess Club": {
        "description": "Learn strategies and compete in chess tournaments",
        "schedule": "Fridays, 3:30 PM - 5:00 PM",
        "max_participants": 12,
        "participants": ["michael@mergington.edu", "daniel@mergington.edu"]
    },
    "Programming Class": {
        "description": "Learn programming fundamentals and build software projects",
        "schedule": "Tuesdays and Thursdays, 3:30 PM - 4:30 PM",
        "max_participants": 20,
        "participants": ["emma@mergington.edu", "sophia@mergington.edu"]
    },
    "Gym Class": {
        "description": "Physical education and sports activities",
        "schedule": "Mondays, Wednesdays, Fridays, 2:00 PM - 3:00 PM",
        "max_participants": 30,
        "participants": ["john@mergington.edu", "olivia@mergington.edu"]
    }
}


@app.get("/")
def root():
    return RedirectResponse(url="/static/todo.html")


@app.get("/activities")
def get_activities():
    return activities


@app.post("/activities/{activity_name}/signup")
def signup_for_activity(activity_name: str, email: str):
    """Sign up a student for an activity"""
    # Validate activity exists
    if activity_name not in activities:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Get the specific activity
    activity = activities[activity_name]

    # Add student
    activity["participants"].append(email)
    return {"message": f"Signed up {email} for {activity_name}"}


# ---------------------------------------------------------------------------
# Todo / Memo App
# ---------------------------------------------------------------------------

class TodoCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    reminder: Optional[str] = None   # ISO-8601 datetime string, e.g. "2025-06-01T09:00"
    tags: Optional[List[str]] = []
    progress: Optional[int] = 0      # 0-100


class TodoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    reminder: Optional[str] = None
    tags: Optional[List[str]] = None
    progress: Optional[int] = None
    completed: Optional[bool] = None


class TimeLogRequest(BaseModel):
    seconds: int   # additional seconds to add to this todo


# In-memory todo storage: { id -> dict }
todos: dict = {}


@app.get("/todos")
def get_todos():
    """Return all todos sorted by creation time (newest first)."""
    return sorted(todos.values(), key=lambda t: t["created_at"], reverse=True)


@app.post("/todos", status_code=201)
def create_todo(todo: TodoCreate):
    """Create a new todo item."""
    todo_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    todos[todo_id] = {
        "id": todo_id,
        "title": todo.title,
        "description": todo.description or "",
        "reminder": todo.reminder,
        "tags": todo.tags or [],
        "progress": max(0, min(100, todo.progress or 0)),
        "completed": False,
        "time_spent": 0,    # total seconds tracked
        "created_at": now,
        "updated_at": now,
    }
    return todos[todo_id]


@app.get("/todos/{todo_id}")
def get_todo(todo_id: str):
    """Return a single todo by id."""
    if todo_id not in todos:
        raise HTTPException(status_code=404, detail="Todo not found")
    return todos[todo_id]


@app.put("/todos/{todo_id}")
def update_todo(todo_id: str, update: TodoUpdate):
    """Update fields of an existing todo."""
    if todo_id not in todos:
        raise HTTPException(status_code=404, detail="Todo not found")
    todo = todos[todo_id]
    if update.title is not None:
        todo["title"] = update.title
    if update.description is not None:
        todo["description"] = update.description
    if update.reminder is not None:
        todo["reminder"] = update.reminder
    if update.tags is not None:
        todo["tags"] = update.tags
    if update.progress is not None:
        todo["progress"] = max(0, min(100, update.progress))
        if todo["progress"] == 100:
            todo["completed"] = True
    if update.completed is not None:
        todo["completed"] = update.completed
        if update.completed:
            todo["progress"] = 100
    todo["updated_at"] = datetime.utcnow().isoformat()
    return todo


@app.delete("/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: str):
    """Delete a todo item."""
    if todo_id not in todos:
        raise HTTPException(status_code=404, detail="Todo not found")
    del todos[todo_id]


@app.post("/todos/{todo_id}/time")
def log_time(todo_id: str, body: TimeLogRequest):
    """Add tracked seconds to a todo item."""
    if todo_id not in todos:
        raise HTTPException(status_code=404, detail="Todo not found")
    if body.seconds < 0:
        raise HTTPException(status_code=400, detail="seconds must be non-negative")
    todos[todo_id]["time_spent"] += body.seconds
    todos[todo_id]["updated_at"] = datetime.utcnow().isoformat()
    return {"id": todo_id, "time_spent": todos[todo_id]["time_spent"]}
