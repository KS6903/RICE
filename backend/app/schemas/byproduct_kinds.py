from pydantic import BaseModel, Field


class ByproductKindCreate(BaseModel):
    name: str = Field(max_length=50)


class ByproductKindUpdate(BaseModel):
    name: str | None = Field(None, max_length=50)
    is_active: bool | None = None
