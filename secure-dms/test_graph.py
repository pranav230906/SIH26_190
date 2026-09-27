import sys
import os
import asyncio
from sqlalchemy.orm import Session

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'backend')))

from backend.app.core.database import SessionLocal
from backend.app.services.graph_service import get_relationship_graph
from backend.app.models.user import User

def test_graph():
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == 'rahul.sharma@police.local').first()
        if not user:
            print("User not found")
            return
        
        print("Calling get_relationship_graph...")
        graph = get_relationship_graph(db, user, 'CASE-2026-001')
        print(f"Success! Nodes: {len(graph.nodes)}, Edges: {len(graph.edges)}")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    test_graph()
