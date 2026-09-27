"""Add is_demo flag to User and Case models.

Revision ID: 0015_add_is_demo
Revises: 0014_prosecutor_workflow
Create Date: 2026-09-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0015_add_is_demo"
down_revision: Union[str, None] = "0014_prosecutor_workflow"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('is_demo', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('cases', sa.Column('is_demo', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('cases', 'is_demo')
    op.drop_column('users', 'is_demo')
