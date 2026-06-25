from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class OptimizeStreamRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    record_ids: List[str] = Field(..., alias="recordIds")


class OptimizeStreamItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    index: int
    record_id: str = Field(..., alias="recordId")
    ok: bool
    fallback: bool = False
    payload: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    changes: List[Dict[str, Any]] = Field(default_factory=list)


class LinKeAccountConfigIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    bd_city_texts: List[str] = Field(..., alias="bdCityTexts")
    cookie_file_path: str = Field(..., alias="cookieFilePath")
    group_id: str = Field("", alias="groupId")
    root_life_account_id: str = Field("", alias="rootLifeAccountId")
    account_id: str = Field("", alias="accountId")
    active: bool = True


class LinKeAccountConfigPatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: Optional[str] = None
    bd_city_texts: Optional[List[str]] = Field(None, alias="bdCityTexts")
    cookie_file_path: Optional[str] = Field(None, alias="cookieFilePath")
    group_id: Optional[str] = Field(None, alias="groupId")
    root_life_account_id: Optional[str] = Field(None, alias="rootLifeAccountId")
    account_id: Optional[str] = Field(None, alias="accountId")
    active: Optional[bool] = None


class LinKeDraftRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    payload: Dict[str, Any]
    record_id: Optional[str] = Field(None, alias="recordId")
    poi_id: Optional[str] = Field(None, alias="poiId")
