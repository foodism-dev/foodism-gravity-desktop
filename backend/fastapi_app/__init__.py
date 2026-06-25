"""FastAPI services for SupplyGoods optimization and Lin-Ke draft creation."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys


def _install_lin_ke_alias() -> None:
    package_name = f"{__name__}.lin_ke"
    if package_name in sys.modules:
        return

    package_dir = Path(__file__).with_name("lin-ke")
    init_file = package_dir / "__init__.py"
    spec = spec_from_file_location(
        package_name,
        init_file,
        submodule_search_locations=[str(package_dir)],
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {package_name} from {package_dir}")

    module = module_from_spec(spec)
    sys.modules[package_name] = module
    spec.loader.exec_module(module)
    setattr(sys.modules[__name__], "lin_ke", module)


_install_lin_ke_alias()
