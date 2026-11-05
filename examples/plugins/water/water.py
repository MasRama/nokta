"""Counts glasses of water for today, in its data folder.

Nokta starts it once and keeps it running (every = 0): each line it prints
is a card, and each button pressed arrives as {"action": "..."} on stdin.
"""

import datetime
import json
import os
import sys

GOAL = int(os.environ.get("NOKTA_OPTION_GOAL", "8"))
STATE = os.path.join(os.environ.get("NOKTA_PLUGIN_DATA", "."), "today.json")


def load():
    today = datetime.date.today().isoformat()
    try:
        with open(STATE, encoding="utf-8") as f:
            saved = json.load(f)
        if saved.get("day") == today:
            return saved
    except (OSError, ValueError):
        pass
    return {"day": today, "glasses": 0}


def save(state):
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(state, f)


def card(state):
    glasses = state["glasses"]
    done = glasses >= GOAL
    out = {
        "title": "Goal reached" if done else f"{glasses} of {GOAL} glasses",
        "detail": "Well done" if done else f"{GOAL - glasses} to go today",
        "tone": "green" if done else "blue",
        "progress": min(glasses / GOAL, 1),
        "badge": "" if done else f"{glasses}/{GOAL}",
        "actions": [{"label": "+1", "run": "drink"}, {"label": "Undo", "run": "undo"}],
    }
    if done:
        out["alert"] = {"id": f"goal-{state['day']}", "title": "Water goal reached", "detail": f"{GOAL} glasses today"}
    print(json.dumps(out), flush=True)


state = load()
card(state)
for line in sys.stdin:
    try:
        action = json.loads(line).get("action")
    except ValueError:
        continue
    state = load()
    if action == "drink":
        state["glasses"] += 1
    elif action == "undo":
        state["glasses"] = max(0, state["glasses"] - 1)
    save(state)
    card(state)
