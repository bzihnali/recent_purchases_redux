#!/usr/bin/env python3
"""
Generates MOD_ICONS and HERO_IMAGES data for the recent_purchases_redux mod.

MOD_ICONS  — built by downloading abilities.vdata from GameTracking-Deadlock and
             cross-referencing against the game's citadel_gc_mod_names localization
             files; one entry per localized item name → panorama image URL.
HERO_IMAGES — built from the game's citadel_gc_hero_names localization files
              combined with the HERO_CODENAME_TO_URL map; one entry per localized
              hero name → panorama image URL.

Usage:
    python3 generate_mod_icons.py [path_to_deadlock_install] [output_file]
    # Default output: panorama/scripts/recent_purchases_redux_data.js
    # The optional first argument overrides the DEADLOCK_PATH environment variable.
"""

import glob
import os
import re
import sys
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT = os.path.join(SCRIPT_DIR, "panorama", "scripts", "recent_purchases_redux_data.js")

# Cache directory for downloaded game data (XDG cache or ~/.cache)
_CACHE_DIR = os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache/deadlock_modding"))
ABILITIES_VDATA = os.path.join(_CACHE_DIR, "abilities.vdata")
ABILITIES_VDATA_URL = (
    "https://raw.githubusercontent.com/SteamTracking/GameTracking-Deadlock"
    "/refs/heads/master/game/citadel/pak01_dir/scripts/abilities.vdata"
)

# Deadlock install path: env var > CLI arg > default Linux path
_DEADLOCK_PATH = os.environ.get(
    "DEADLOCK_PATH",
    os.path.expanduser("~/.local/share/Steam/steamapps/common/Deadlock")
)
if len(sys.argv) > 1:
    _DEADLOCK_PATH = sys.argv[1]

OUTPUT_FILE = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUTPUT

HERO_LOCA_DIR = os.path.join(_DEADLOCK_PATH, "game/citadel/resource/localization/citadel_gc_hero_names")
MOD_LOCA_DIR = os.path.join(_DEADLOCK_PATH, "game/citadel/resource/localization/citadel_gc_mod_names")

# GC internal codename -> panorama image URL (source of truth for image paths).
# Derived from the existing HERO_IMAGES entries; codename is the hero_* key stem.
HERO_CODENAME_TO_URL = {
    "atlas":       'url(\\"s2r://panorama/images/heroes/bull_sm_psd.vtex\\")',
    "bebop":       'url(\\"s2r://panorama/images/heroes/bebop_sm_psd.vtex\\")',
    "punkgoat":    'url(\\"s2r://panorama/images/heroes/punkgoat_sm_psd.vtex\\")',
    "nano":        'url(\\"s2r://panorama/images/heroes/nano_sm_psd.vtex\\")',
    "drifter":     'url(\\"s2r://panorama/images/heroes/drifter_sm_psd.vtex\\")',
    "dynamo":      'url(\\"s2r://panorama/images/heroes/sumo_sm_psd.vtex\\")',
    "slork":       'url(\\"s2r://panorama/images/heroes/slork_sm_psd.vtex\\")',
    "orion":       'url(\\"s2r://panorama/images/heroes/archer_sm_psd.vtex\\")',
    "haze":        'url(\\"s2r://panorama/images/heroes/haze_sm_psd.vtex\\")',
    "astro":       'url(\\"s2r://panorama/images/heroes/astro_sm_psd.vtex\\")',
    "inferno":     'url(\\"s2r://panorama/images/heroes/inferno_sm_psd.vtex\\")',
    "tengu":       'url(\\"s2r://panorama/images/heroes/tengu_sm_psd.vtex\\")',
    "kelvin":      'url(\\"s2r://panorama/images/heroes/kelvin_sm_psd.vtex\\")',
    "kali":        'url(\\"s2r://panorama/images/heroes/kali_sm_psd.vtex\\")',
    "viper":       'url(\\"s2r://panorama/images/heroes/viper_sm_psd.vtex\\")',
    "ghost":       'url(\\"s2r://panorama/images/heroes/spectre_sm_psd.vtex\\")',
    "lash":        'url(\\"s2r://panorama/images/heroes/lash_sm_psd.vtex\\")',
    "forge":       'url(\\"s2r://panorama/images/heroes/engineer_sm_psd.vtex\\")',
    "vampirebat":  'url(\\"s2r://panorama/images/heroes/vampirebat_sm_psd.vtex\\")',
    "mirage":      'url(\\"s2r://panorama/images/heroes/mirage_sm_psd.vtex\\")',
    "krill":       'url(\\"s2r://panorama/images/heroes/digger_sm_psd.vtex\\")',
    "bookworm":    'url(\\"s2r://panorama/images/heroes/bookworm_sm_psd.vtex\\")',
    "chrono":      'url(\\"s2r://panorama/images/heroes/chrono_sm_psd.vtex\\")',
    "synth":       'url(\\"s2r://panorama/images/heroes/synth_sm_psd.vtex\\")',
    "rutger":      'url(\\"s2r://panorama/images/heroes/rutger_sm_psd.vtex\\")',
    "gigawatt":    'url(\\"s2r://panorama/images/heroes/gigawatt_sm_psd.vtex\\")',
    "shiv":        'url(\\"s2r://panorama/images/heroes/shiv_sm_psd.vtex\\")',
    "magician":    'url(\\"s2r://panorama/images/heroes/magician_sm_psd.vtex\\")',
    "doorman":     'url(\\"s2r://panorama/images/heroes/doorman_sm_psd.vtex\\")',
    "tokamak":     'url(\\"s2r://panorama/images/heroes/tokamak_sm_psd.vtex\\")',
    "trapper":     'url(\\"s2r://panorama/images/heroes/trapper_sm_psd.vtex\\")',
    "frank":       'url(\\"s2r://panorama/images/heroes/frank_sm_psd.vtex\\")',
    "hornet":      'url(\\"s2r://panorama/images/heroes/hornet_sm_png.vtex\\")',
    "viscous":     'url(\\"s2r://panorama/images/heroes/viscous_sm_psd.vtex\\")',
    "warden":      'url(\\"s2r://panorama/images/heroes/warden_sm_psd.vtex\\")',
    "wraith":      'url(\\"s2r://panorama/images/heroes/wraith_sm_psd.vtex\\")',
    "wrecker":     'url(\\"s2r://panorama/images/heroes/wrecker_sm_psd.vtex\\")',
    "yamato":      'url(\\"s2r://panorama/images/heroes/yamato_sm_psd.vtex\\")',
    "cadence":     'url(\\"s2r://panorama/images/heroes/cadence_sm_psd.vtex\\")',
    "druid":       'url(\\"s2r://panorama/images/heroes/druid_sm_psd.vtex\\")',
    "fortuna":     'url(\\"s2r://panorama/images/heroes/fortuna_sm_psd.vtex\\")',
    "graf":        'url(\\"s2r://panorama/images/heroes/graf_sm_psd.vtex\\")',
    "gunslinger":  'url(\\"s2r://panorama/images/heroes/gunslinger_sm_psd.vtex\\")',
    "operative":   'url(\\"s2r://panorama/images/heroes/operative_sm_psd.vtex\\")',
    "yakuza":      'url(\\"s2r://panorama/images/heroes/yakuza_sm_psd.vtex\\")',
    "thumper":     'url(\\"s2r://panorama/images/heroes/thumper_sm_psd.vtex\\")',
    "vandal":      'url(\\"s2r://panorama/images/heroes/vandal_sm_psd.vtex\\")',
    "skyrunner":   'url(\\"s2r://panorama/images/heroes/skyrunner_sm_psd.vtex\\")',
    "swan":        'url(\\"s2r://panorama/images/heroes/swan_sm_psd.vtex\\")',
    "fencer":      'url(\\"s2r://panorama/images/heroes/fencer_sm_psd.vtex\\")',
    "unicorn":     'url(\\"s2r://panorama/images/heroes/unicorn_sm_psd.vtex\\")',
    "necro":       'url(\\"s2r://panorama/images/heroes/necro_sm_psd.vtex\\")',
    "familiar":    'url(\\"s2r://panorama/images/heroes/familiar_sm_psd.vtex\\")',
    "werewolf":    'url(\\"s2r://panorama/images/heroes/werewolf_sm_psd.vtex\\")',
    "priest":      'url(\\"s2r://panorama/images/heroes/priest_sm_psd.vtex\\")',
}

# Matches: "hero_<codename>:n" "<name>"
_HERO_TOKEN_RE = re.compile(r'"hero_(\w+):n"\s+"([^"]+)"')
# Matches: "upgrade_<key>" "<name>"  (no :n suffix for mod names)
_MOD_TOKEN_RE = re.compile(r'"(upgrade_\w+)"\s+"([^"]+)"')
# Strips gender/grammatical markers like #|m|# or #|f|#
_GENDER_PREFIX_RE = re.compile(r'^#\|[a-z]+\|#')
# Matches upgrade block keys and image fields in abilities.vdata
_VDATA_KEY_RE = re.compile(r'^\t(upgrade_\w+) = \s*$')
_VDATA_SHOP_ICON_RE = re.compile(r'm_strShopIconLarge = panorama:"file://\{images\}/(.+?\.psd)"')
_VDATA_ABILITY_IMG_RE = re.compile(r'm_strAbilityImage = panorama:"file://\{images\}/(.+?\.psd)"')


def parse_hero_loca_file(path):
    """Return {codename: display_name} for all :n tokens in a localization file."""
    result = {}
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            m = _HERO_TOKEN_RE.search(line)
            if not m:
                continue
            codename, name = m.group(1), m.group(2)
            name = _GENDER_PREFIX_RE.sub("", name).strip()
            if name:
                result[codename] = name
    return result


def raw_path_to_url(raw_path):
    """Convert a bare image path (after stripping file://{images}/) to a JS url() string.
    .psd -> _psd.vtex, anything else (e.g. .svg) left as-is since it's unusable."""
    path = "s2r://panorama/images/" + raw_path
    path = re.sub(r"\.psd$", "_psd.vtex", path)
    return f'url(\\"{path}\\")'



def fetch_vdata_if_needed():
    """Download abilities.vdata if not already cached. Returns True on success."""
    if os.path.exists(ABILITIES_VDATA):
        return True
    print(f"Downloading abilities.vdata from GitHub...")
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        urllib.request.urlretrieve(ABILITIES_VDATA_URL, ABILITIES_VDATA)
        print(f"  Saved to {ABILITIES_VDATA}")
        return True
    except Exception as e:
        print(f"  ERROR: Could not download abilities.vdata: {e}")
        print(f"  URL: {ABILITIES_VDATA_URL}")
        return False


def parse_vdata_icons():
    """Return {upgrade_key: url} parsed from abilities.vdata.
    Prefers m_strShopIconLarge (the actual shop icon) over m_strAbilityImage.
    Only considers .psd paths; SVG and other formats are ignored.
    Returns empty dict if the data file is unavailable (offline)."""
    if not fetch_vdata_if_needed():
        return {}
    shop_icons = {}   # upgrade_key -> url from m_strShopIconLarge
    ability_imgs = {} # upgrade_key -> url from m_strAbilityImage (fallback)
    current_key = None
    brace_depth = 0
    with open(ABILITIES_VDATA, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if current_key is None:
                m = _VDATA_KEY_RE.match(line)
                if m:
                    current_key = m.group(1)
                    brace_depth = 0
            else:
                brace_depth += line.count("{") - line.count("}")
                if current_key not in shop_icons:
                    m = _VDATA_SHOP_ICON_RE.search(line)
                    if m:
                        shop_icons[current_key] = raw_path_to_url(m.group(1))
                if current_key not in ability_imgs:
                    m = _VDATA_ABILITY_IMG_RE.search(line)
                    if m:
                        ability_imgs[current_key] = raw_path_to_url(m.group(1))
                if brace_depth <= 0 and "{" not in line and "}" in line:
                    current_key = None
    # Merge: shop icon takes priority over ability image
    results = {**ability_imgs, **shop_icons}
    return results


def js_entry(name, url):
    escaped = name.replace("\\", "\\\\").replace('"', '\\"')
    return f'        "{escaped}": "{url}"'


def parse_mod_loca_file(path):
    """Return {upgrade_key: display_name} for all non-search/sort tokens in a loca file."""
    result = {}
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            m = _MOD_TOKEN_RE.search(line)
            if not m:
                continue
            key, name = m.group(1), m.group(2)
            if key.endswith(("_search", "_sort")):
                continue
            name = _GENDER_PREFIX_RE.sub("", name).strip()
            if name:
                result[key] = name
    return result


def build_mod_icons():
    key_to_url = parse_vdata_icons()
    loca_files = glob.glob(os.path.join(MOD_LOCA_DIR, "*.txt"))
    entries = {}
    for path in loca_files:
        for key, name in parse_mod_loca_file(path).items():
            url = key_to_url.get(key)
            if url:
                entries[name] = url
    return entries


def build_hero_images():
    loca_files = glob.glob(os.path.join(HERO_LOCA_DIR, "*.txt"))
    entries = {}
    for path in loca_files:
        for codename, name in parse_hero_loca_file(path).items():
            url = HERO_CODENAME_TO_URL.get(codename)
            if url:
                entries[name] = url
    return entries


def write_const(f, const_name, entries):
    lines = [js_entry(n, u) for n, u in sorted(entries.items(), key=lambda kv: kv[0].lower())]
    f.write(f"    const {const_name} = {{\n")
    f.write(",\n".join(lines) + "\n")
    f.write("    };\n")


def main():
    # Validate loca directories exist
    if not os.path.isdir(MOD_LOCA_DIR):
        print(f"ERROR: Mod loca directory not found: {MOD_LOCA_DIR}")
        print(f"Set DEADLOCK_PATH env var or pass it as the first argument.")
        sys.exit(1)
    if not os.path.isdir(HERO_LOCA_DIR):
        print(f"ERROR: Hero loca directory not found: {HERO_LOCA_DIR}")
        print(f"Set DEADLOCK_PATH env var or pass it as the first argument.")
        sys.exit(1)

    # Download item icon data (graceful fallback if offline)
    if not fetch_vdata_if_needed():
        print("WARNING: Could not fetch abilities.vdata — MOD_ICONS may be incomplete.")

    # Generate
    mod_icons = build_mod_icons()
    hero_images = build_hero_images()

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        write_const(f, "MOD_ICONS", mod_icons)
        f.write("\n")
        write_const(f, "HERO_IMAGES", hero_images)

    print(f"Written {len(mod_icons)} mod icons + {len(hero_images)} hero images to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
