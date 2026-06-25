import json
import re
from pathlib import Path
from typing import Any, Dict, Optional


MAPPING_PATH = Path(__file__).with_name("lin_ke_mappings.json")
REQUIRED_MEAL_TYPE_FIELDS = ("productType", "name")
REQUIRED_CLASSIFICATION_FIELDS = ("categoryId", "thirdCategoryId", "categoryName", "categoryPath")


class ProductMappingError(Exception):
    def __init__(self, reason: str, **details: Any):
        payload = {"ok": False, "stage": "product_mapping_required", "reason": reason}
        payload.update(details)
        super().__init__(reason)
        self.payload = payload


def clean_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def entity_text(value: Any) -> str:
    if isinstance(value, dict):
        return clean_string(value.get("text"))
    return clean_string(value)


def normalize_classification_label(value: Any) -> str:
    text = entity_text(value)
    if not text:
        return ""
    text = re.sub(r"\s*\.\s*", " / ", text)
    text = re.sub(r"\s+/\s+", " / ", text)
    text = re.sub(r"\s+", " ", text)
    parts = [part.strip() for part in text.split(" / ") if part.strip()]
    return " / ".join(parts)


def load_mapping_file(path: Optional[Path] = None) -> Dict[str, Any]:
    mapping_path = path or MAPPING_PATH
    try:
        data = json.loads(mapping_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductMappingError("mapping_file_not_found", mappingPath=str(mapping_path)) from exc
    except json.JSONDecodeError as exc:
        raise ProductMappingError("mapping_file_invalid_json", mappingPath=str(mapping_path), error=str(exc)) from exc
    validate_mapping_file(data, mapping_path)
    return data


def validate_mapping_file(data: Dict[str, Any], mapping_path: Path = MAPPING_PATH) -> None:
    if not isinstance(data, dict):
        raise ProductMappingError("mapping_file_must_be_object", mappingPath=str(mapping_path))
    for section in ("mealTypes", "classifications", "excludedClassifications"):
        if section not in data:
            raise ProductMappingError("mapping_file_missing_section", mappingPath=str(mapping_path), section=section)
    if not isinstance(data["mealTypes"], dict):
        raise ProductMappingError("mapping_file_invalid_section", mappingPath=str(mapping_path), section="mealTypes")
    if not isinstance(data["classifications"], dict):
        raise ProductMappingError("mapping_file_invalid_section", mappingPath=str(mapping_path), section="classifications")
    if not isinstance(data["excludedClassifications"], list):
        raise ProductMappingError(
            "mapping_file_invalid_section",
            mappingPath=str(mapping_path),
            section="excludedClassifications",
        )
    for key, value in data["mealTypes"].items():
        if not isinstance(value, dict):
            raise ProductMappingError("mapping_file_invalid_meal_type", mappingPath=str(mapping_path), mealType=key)
        missing = [field for field in REQUIRED_MEAL_TYPE_FIELDS if field not in value]
        if missing:
            raise ProductMappingError(
                "mapping_file_missing_meal_type_field",
                mappingPath=str(mapping_path),
                mealType=key,
                missingFields=missing,
            )
    for key, value in data["classifications"].items():
        if not isinstance(value, dict):
            raise ProductMappingError(
                "mapping_file_invalid_classification",
                mappingPath=str(mapping_path),
                classification=key,
            )
        missing = [field for field in REQUIRED_CLASSIFICATION_FIELDS if field not in value]
        if missing:
            raise ProductMappingError(
                "mapping_file_missing_classification_field",
                mappingPath=str(mapping_path),
                classification=key,
                missingFields=missing,
            )


def meal_type_text(payload: Dict[str, Any]) -> str:
    return entity_text(payload.get("mealType") or payload.get("mealType.text"))


def classification_text(payload: Dict[str, Any]) -> str:
    return entity_text(payload.get("classification") or payload.get("classification.text"))


def is_excluded_classification(classification_key: str, excluded: Any) -> bool:
    if not classification_key or not isinstance(excluded, list):
        return False
    for raw_prefix in excluded:
        prefix = normalize_classification_label(raw_prefix)
        if prefix and (classification_key == prefix or classification_key.startswith(prefix + " / ")):
            return True
    return False


def resolve_lin_ke_mapping(payload: Dict[str, Any], mapping_path: Optional[Path] = None) -> Dict[str, Any]:
    mapping = load_mapping_file(mapping_path)
    meal_text = meal_type_text(payload)
    if not meal_text:
        raise ProductMappingError("missing_meal_type", field="mealType")
    meal_mapping = mapping["mealTypes"].get(meal_text)
    if not meal_mapping:
        raise ProductMappingError("unknown_meal_type", mealType=meal_text)

    raw_classification_text = classification_text(payload)
    classification_key = normalize_classification_label(raw_classification_text)
    if not classification_key:
        raise ProductMappingError("missing_classification", field="classification")
    if is_excluded_classification(classification_key, mapping["excludedClassifications"]):
        raise ProductMappingError("excluded_classification", classificationKey=classification_key)
    classification_mapping = mapping["classifications"].get(classification_key)
    if not classification_mapping:
        raise ProductMappingError("unknown_classification", classificationKey=classification_key)

    return {
        "productType": int(meal_mapping["productType"]),
        "productTypeName": clean_string(meal_mapping["name"]),
        "categoryId": clean_string(classification_mapping["categoryId"]),
        "thirdCategoryId": clean_string(classification_mapping["thirdCategoryId"]),
        "categoryName": clean_string(classification_mapping["categoryName"]),
        "categoryPath": clean_string(classification_mapping["categoryPath"]),
        "mealTypeText": meal_text,
        "classificationText": raw_classification_text,
        "classificationKey": classification_key,
    }
