#!/usr/bin/env python3
"""
Simule plusieurs agents Claude qui travaillent, et envoie leurs événements à l'ESP32.

Usage :
    python mock_agents.py --host 192.168.1.50            # envoie à l'ESP32
    python mock_agents.py --dry                          # affiche seulement, n'envoie rien
    python mock_agents.py --host 192.168.1.50 --interval 1.5

Aucune dépendance (bibliothèque standard uniquement).
Événement envoyé : POST http://<host>/event  {"agent": "...", "state": "...", "task": "..."}
"""
import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request

AGENTS = {
    "refacto-api":   ["Read src/api/routes.py", "Edit src/api/routes.py", "Grep 'def handler'", "Bash pytest -q"],
    "doc-writer":    ["Read README.md", "Write docs/usage.md", "Edit docs/usage.md", "WebFetch docs.python.org"],
    "bug-hunter":    ["Grep 'TODO|FIXME'", "Read logs/error.log", "Bash git log -n 20", "Edit src/core.py"],
    "migration-db":  ["Read schema.sql", "Bash alembic upgrade head", "Edit models.py", "Bash pytest tests/db"],
    "code-review":   ["Read diff.patch", "Grep 'password'", "Read src/auth.py", "Write review.md"],
}

WAIT_REASONS = ["Valider: Bash rm -rf build/", "Valider: Edit .env", "Valider: Bash git push", "Question: quelle branche ?"]


class MockAgent:
    def __init__(self, name, tasks):
        self.name = name
        self.tasks = tasks
        self.state = "done"
        self.task = ""
        self.steps_left = 0
        self.resume_at = time.time() + random.uniform(0, 4)   # démarrages échelonnés

    def step(self, now):
        """Fait avancer l'agent d'un pas. Retourne True si l'état ou la tâche a changé."""
        if self.state in ("done", "error"):
            if now < self.resume_at:
                return False
            self.state, self.steps_left = "working", random.randint(4, 9)
            self.task = random.choice(self.tasks)
            return True

        if self.state == "waiting":
            if random.random() < 0.35:                     # l'utilisateur a validé
                self.state, self.task = "working", random.choice(self.tasks)
                return True
            return False

        # working
        roll = random.random()
        if roll < 0.10:
            self.state, self.task = "waiting", random.choice(WAIT_REASONS)
        elif roll < 0.14:
            self.state, self.task = "error", "Échec: exit code 1"
            self.resume_at = now + random.uniform(8, 15)
        else:
            self.steps_left -= 1
            if self.steps_left <= 0:
                self.state, self.task = "done", "Terminé"
                self.resume_at = now + random.uniform(10, 25)
            else:
                self.task = random.choice(self.tasks)
        return True


def send(host, agent, dry):
    payload = {"agent": agent.name, "state": agent.state, "task": agent.task}
    line = f"{time.strftime('%H:%M:%S')}  {agent.name:<13} {agent.state:<8} {agent.task}"
    if dry:
        print(line)
        return
    req = urllib.request.Request(
        f"http://{host}/event",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=2) as resp:
            print(f"{line}   -> HTTP {resp.status}")
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"{line}   -> ERREUR {e}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", help="IP ou nom de l'ESP32 (affichée au démarrage dans le moniteur série)")
    ap.add_argument("--interval", type=float, default=2.0, help="secondes entre deux ticks (défaut 2)")
    ap.add_argument("--dry", action="store_true", help="n'envoie rien, affiche seulement")
    args = ap.parse_args()
    sys.stdout.reconfigure(errors="replace")      # évite un plantage sur les consoles non UTF-8
    if not args.dry and not args.host:
        ap.error("--host est requis (ou utilisez --dry)")

    agents = [MockAgent(n, t) for n, t in AGENTS.items()]
    last_beat = {a.name: 0.0 for a in agents}
    print("Ctrl+C pour arrêter.")
    try:
        while True:
            now = time.time()
            for a in agents:
                changed = a.step(now) if random.random() < 0.6 else False
                heartbeat = a.state in ("working", "waiting") and now - last_beat[a.name] > 30
                if changed or heartbeat:        # le heartbeat évite l'expiration côté ESP32
                    send(args.host, a, args.dry)
                    last_beat[a.name] = now
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nArrêt.")


if __name__ == "__main__":
    main()
