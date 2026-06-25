from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class OptimizeStreamRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    supply_goods_ids: List[str] = Field(..., alias="supplyGoodsIds")


class OptimizeStreamItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    index: int
    supply_goods_id: str = Field(..., alias="supplyGoodsId")
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
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    payload: Dict[str, Any]
    supply_goods_id: str = Field(..., alias="supplyGoodsId")
    poi_id: Optional[str] = Field(None, alias="poiId")
