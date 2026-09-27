"""add file security scans

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-27 13:10:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0016'
down_revision = '0015_add_is_demo'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        'file_security_scans',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('file_hash', sa.String(length=64), nullable=False),
        sa.Column('hash_algorithm', sa.String(length=16), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('scanner_name', sa.String(length=128), nullable=False),
        sa.Column('message', sa.String(length=500), nullable=True),
        sa.Column('scanned_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_file_security_scans_file_hash'), 'file_security_scans', ['file_hash'], unique=True)

def downgrade() -> None:
    op.drop_index(op.f('ix_file_security_scans_file_hash'), table_name='file_security_scans')
    op.drop_table('file_security_scans')
