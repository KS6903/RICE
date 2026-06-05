"""Unit tests for BaseRepository (Phase 1.2).

Uses the real Branch model because it carries both ``company_id`` (tenant scope)
and ``deleted_at`` (soft delete), so it exercises every base behavior.
"""
from app.models.company import Branch, Company
from app.repositories.base import BaseRepository


class BranchRepository(BaseRepository[Branch]):
    model = Branch


def _company(db, name="Co"):
    c = Company(name=name)
    db.add(c)
    db.flush()
    return c


def test_add_flushes_and_assigns_pk(db_session):
    repo = BranchRepository(db_session)
    company = _company(db_session)
    branch = repo.add(Branch(company_id=company.id, name="Main", is_main_branch=True))
    assert branch.id is not None  # flush populated the PK without a commit


def test_list_scopes_by_tenant(db_session):
    repo = BranchRepository(db_session)
    a, b = _company(db_session, "A"), _company(db_session, "B")
    repo.add(Branch(company_id=a.id, name="A-main"))
    repo.add(Branch(company_id=a.id, name="A-2"))
    repo.add(Branch(company_id=b.id, name="B-main"))

    a_branches = repo.list(where=[Branch.company_id == a.id])
    assert {br.name for br in a_branches} == {"A-main", "A-2"}


def test_soft_delete_hides_row_by_default(db_session):
    repo = BranchRepository(db_session)
    company = _company(db_session)
    branch = repo.add(Branch(company_id=company.id, name="Temp"))

    repo.soft_delete(branch)

    live = repo.list(where=[Branch.company_id == company.id])
    assert all(br.id != branch.id for br in live)

    # ...but visible when explicitly including deleted rows.
    incl = repo.list(where=[Branch.company_id == company.id], include_deleted=True)
    assert any(br.id == branch.id for br in incl)

    # get() respects soft-delete too.
    assert repo.get(branch.id) is None
    assert repo.get(branch.id, include_deleted=True) is not None


def test_get_for_company_blocks_cross_tenant_access(db_session):
    repo = BranchRepository(db_session)
    a, b = _company(db_session, "A"), _company(db_session, "B")
    branch_a = repo.add(Branch(company_id=a.id, name="A-main"))

    assert repo.get_for_company(branch_a.id, a.id) is not None
    # Same row, wrong tenant -> not found.
    assert repo.get_for_company(branch_a.id, b.id) is None
