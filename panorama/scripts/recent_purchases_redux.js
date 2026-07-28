(function () {
    "use strict";

    if ($.DbgIsReloadingScript()) return;
    // Use distinct local names to avoid shadowing the data file's global const
    // MOD_ICONS / HERO_IMAGES.  `var` hoisting inside an IIFE would make
    // `typeof MOD_ICONS` check the local (uninitialised) binding, always seeing
    // "undefined" and replacing the real data with {}.
    var _MOD_ICONS = typeof MOD_ICONS !== "undefined" ? MOD_ICONS : {};

    // ─── Config ───────────────────────────────────────────────────────────────────

    const DEBUG = false;
    const DEBUG_QUICK = false;

    const MAIN_POLL_INTERVAL = 0.1;
    const HIDEOUT_POLL_INTERVAL = 1.0;

    const QUICK_MAX_ENTRIES = 3;
    const QUICK_DISPLAY_DURATION = 10.0;
    const QUICK_FADE_DURATION = 0.3;
    const SEEN_KEYS_PRUNE_INTERVAL = 100;

    const CONTAINER_MAX_ITEMS = 50;

    // ─── Filter definitions ───────────────────────────────────────────────────────

    const FILTERS = [
        {
            id: "Tier1Toggle", label: "T1", group: "tier", active: true, invert: true,
            ShouldHideItem: function (p) { return p.BHasClass("isTier1Purchase"); }
        },
        {
            id: "Tier2Toggle", label: "T2", group: "tier", active: true, invert: true,
            ShouldHideItem: function (p) { return p.BHasClass("isTier2Purchase"); }
        },
        {
            id: "Tier3Toggle", label: "T3", group: "tier", active: true, invert: true,
            ShouldHideItem: function (p) { return p.BHasClass("isTier3Purchase"); }
        },
        {
            id: "Tier4Toggle", label: "T4", group: "tier", active: true, invert: true,
            ShouldHideItem: function (p) { return p.BHasClass("isTier4Purchase"); }
        },
        {
            id: "Team1OnlyToggle", label: "Hidden King", group: "team", active: true, invert: true,
            ShouldShowToggle: function (ctx) { return ctx.isSpectator; },
            ShouldHideItem: function (p) { return p.BHasClass("isTeam1Purchase"); }
        },
        {
            id: "Team2OnlyToggle", label: "Archmother", group: "team", active: true, invert: true,
            ShouldShowToggle: function (ctx) { return ctx.isSpectator; },
            ShouldHideItem: function (p) { return p.BHasClass("isTeam2Purchase"); }
        },
        {
            id: "MyTeamToggle", label: "My Team", group: "team", active: true, invert: true,
            ShouldShowToggle: function (ctx) { return !ctx.isSpectator; },
            ShouldHideItem: function (p, ctx) {
                if (ctx.localTeam === 1) return p.BHasClass("isTeam1Purchase");
                if (ctx.localTeam === 2) return p.BHasClass("isTeam2Purchase");
                return false;
            }
        },
        {
            id: "EnemyTeamToggle", label: "Enemy Team", group: "team", active: true, invert: true,
            ShouldShowToggle: function (ctx) { return !ctx.isSpectator; },
            ShouldHideItem: function (p, ctx) {
                if (ctx.localTeam === 1) return p.BHasClass("isTeam2Purchase");
                if (ctx.localTeam === 2) return p.BHasClass("isTeam1Purchase");
                return false;
            }
        }
    ];

    const QUICK_CLASSES_TO_COPY = [
        "isTier1Purchase", "isTier2Purchase", "isTier3Purchase", "isTier4Purchase",
        "isWeaponPurchase", "isArmorPurchase", "isTechPurchase",
        "isTeam1Purchase", "isTeam2Purchase"
    ];

    // ─── Shared state ─────────────────────────────────────────────────────────────

    var cachedRoot = null;
    var cachedContainer = null;

    // Filter state
    var filtersCreated = false;
    var lastFilterSig = null;
    var lastFirstPurchase = null;
    var lastVisibilitySig = null;

    // Hideout state
    var wasInHideout = null;

    // Error logging state
    var _errorCounter = 0;
    var _lastErrorMessage = "";

    // Quick purchases state
    var quickSeenKeys = {};
    var quickInitialized = false;
    var heroNameMap = {};           // UPPERCASE hero name → CitadelHudTopBarPlayer panel
    // heroMapState enum
    var HERO_MAP_IDLE = 0;
    var HERO_MAP_BUILDING = 1;
    var HERO_MAP_BUILT = 2;
    var heroMapState = HERO_MAP_IDLE;
    var _heroMapBuildGeneration = 0;
    var quickPanelsByHero = {};     // UPPERCASE hero name → QuickPurchasesPanel
    var quickActiveEntriesByHero = {}; // UPPERCASE hero name → []


    // ─── Shared utilities ─────────────────────────────────────────────────────────

    function GetAbsoluteRoot() {
        if (cachedRoot && cachedRoot.IsValid()) return cachedRoot;
        var root = $.GetContextPanel();
        while (root.GetParent() !== null) root = root.GetParent();
        cachedRoot = root;
        return root;
    }

    function GetContainer(globalRoot) {
        if (cachedContainer && cachedContainer.IsValid()) return cachedContainer;
        cachedContainer = globalRoot.FindChildTraverse("RecentPurchasesContainer");
        return cachedContainer;
    }

    function GetChildText(panel, className) {
        if (!panel || !panel.IsValid()) return "";
        var labels = panel.FindChildrenWithClassTraverse(className);
        return (labels && labels.length > 0 && labels[0].IsValid()) ? labels[0].text.trim() : "";
    }

    function ArrayRemove(arr, item) {
        var result = [];
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] !== item) result.push(arr[i]);
        }
        return result;
    }

    // ─── Mod icon setting ─────────────────────────────────────────────────────────

    function UpdateModIcons(container, purchases) {
        if (!container || !container.IsValid()) return;
        if (!purchases) purchases = container.FindChildrenWithClassTraverse("recentPurchase");
        for (var i = 0; i < purchases.length; i++) {
            var purchase = purchases[i];
            if (!purchase || !purchase.IsValid()) continue;
            var icons = purchase.FindChildrenWithClassTraverse("mod_icon");
            if (!icons || icons.length === 0) continue;
            var icon = icons[0];
            if (!icon.IsValid() || icon.BHasClass("iconSet")) continue;
            var itemName = GetChildText(purchase, "recentModPurchaseName");
            if (!itemName) continue;
            var image = _MOD_ICONS[itemName];
            if (!image) continue;
            icon.style.backgroundImage = image;
            icon.style.washColor = "none";
            icon.AddClass("iconSet");
        }
    }

    // ─── Purchase filters ─────────────────────────────────────────────────────────

    function BuildContext(container) {
        var ctx = { isSpectator: false, localTeam: 0 };
        ctx.isSpectator = $.GetContextPanel().BAscendantHasClass("TeamSpectator");
        if (!ctx.isSpectator && container && container.IsValid()) {
            if (container.BAscendantHasClass("localPlayerTeam1")) ctx.localTeam = 1;
            else if (container.BAscendantHasClass("localPlayerTeam2")) ctx.localTeam = 2;
        }
        return ctx;
    }

    function GetFilterSignature(ctx, container) {
        var sig = (ctx.isSpectator ? "1" : "0") + ctx.localTeam + container.GetChildCount();
        for (var i = 0; i < FILTERS.length; i++) {
            var filter = FILTERS[i];
            if (filter.ShouldShowToggle && !filter.ShouldShowToggle(ctx)) continue;
            sig += filter.active ? "1" : "0";
        }
        return sig;
    }

    function CreateFilterCheckboxes(globalRoot) {
        if (filtersCreated) return;
        var panel = globalRoot.FindChildTraverse("RecentPurchasesPanel");
        if (!panel) return;

        var collapseToggle = $.CreatePanel("ToggleButton", panel, "FiltersCollapseToggle");
        collapseToggle.AddClass("PurchaseFilterToggle");
        collapseToggle.checked = true;
        var collapseLabel = $.CreatePanel("Label", collapseToggle, "");
        collapseLabel.text = "Show Filters";

        var filtersPanel = $.CreatePanel("Panel", panel, "PurchaseFiltersContainer");
        var filtersVisible = true;
        $.RegisterEventHandler("Activated", collapseToggle, function () {
            filtersVisible = !filtersVisible;
            if (filtersVisible) filtersPanel.RemoveClass("filterButtonHidden");
            else filtersPanel.AddClass("filterButtonHidden");
        });

        var groupPanels = {};
        for (var i = 0; i < FILTERS.length; i++) {
            var filter = FILTERS[i];
            var parent = filtersPanel;
            if (filter.group) {
                if (!groupPanels[filter.group]) {
                    groupPanels[filter.group] = $.CreatePanel("Panel", filtersPanel, "FilterGroup_" + filter.group);
                    groupPanels[filter.group].AddClass("PurchaseFilterGroup");
                }
                parent = groupPanels[filter.group];
            }
            var toggle = $.CreatePanel("ToggleButton", parent, filter.id);
            toggle.AddClass("PurchaseFilterToggle");
            toggle.checked = filter.active;
            var label = $.CreatePanel("Label", toggle, "");
            label.text = filter.label;
            (function (f) {
                $.RegisterEventHandler("Activated", toggle, function () {
                    f.active = !f.active;
                    if (DEBUG) $.Msg("[Filters] " + f.id + " active=" + f.active);
                });
            })(filter);
        }

        var existingLabel = panel.FindChild("RecentPurchases");
        var container = panel.FindChild("RecentPurchasesContainer");
        if (existingLabel) existingLabel.SetParent(panel);
        if (container) container.SetParent(panel);

        filtersCreated = true;
    }

    function UpdateFilterVisibility(globalRoot, ctx) {
        var visSig = (ctx.isSpectator ? "1" : "0") + ctx.localTeam;
        if (visSig === lastVisibilitySig) return;
        lastVisibilitySig = visSig;
        for (var i = 0; i < FILTERS.length; i++) {
            var filter = FILTERS[i];
            if (!filter.ShouldShowToggle) continue;
            var toggle = globalRoot.FindChildTraverse(filter.id);
            if (!toggle) continue;
            if (filter.ShouldShowToggle(ctx)) toggle.RemoveClass("filterButtonHidden");
            else toggle.AddClass("filterButtonHidden");
        }
    }

    function ApplyFilters(container, ctx, purchases) {
        if (!container || !container.IsValid()) return;
        var sig = GetFilterSignature(ctx, container);
        var firstChild = container.GetChildCount() > 0 ? container.GetChild(0) : null;
        if (sig === lastFilterSig && firstChild === lastFirstPurchase) return;
        lastFilterSig = sig;
        lastFirstPurchase = firstChild;
        if (DEBUG) $.Msg("[Filters] Signature changed: " + sig);

        if (!purchases) purchases = container.FindChildrenWithClassTraverse("recentPurchase");
        for (var i = 0; i < purchases.length; i++) {
            var purchase = purchases[i];
            if (!purchase || !purchase.IsValid()) continue;
            var hidden = false;
            for (var j = 0; j < FILTERS.length; j++) {
                var filter = FILTERS[j];
                if (filter.ShouldShowToggle && !filter.ShouldShowToggle(ctx)) continue;
                var shouldApply = filter.invert ? !filter.active : filter.active;
                if (shouldApply && filter.ShouldHideItem(purchase, ctx)) { hidden = true; break; }
            }
            if (hidden) purchase.AddClass("filterHidden");
            else purchase.RemoveClass("filterHidden");
        }
    }

    // ─── Container cap ───────────────────────────────────────────────────────────

    function CapContainer(container) {
        if (!container || !container.IsValid()) return;
        var count = container.GetChildCount();
        while (count > CONTAINER_MAX_ITEMS) {
            container.GetChild(count - 1).DeleteAsync(0);
            count--;
        }
    }

    var _seenKeysPruneCounter = 0;
    function PruneSeenKeys(container, purchases) {
        _seenKeysPruneCounter++;
        if (_seenKeysPruneCounter < SEEN_KEYS_PRUNE_INTERVAL) return;
        _seenKeysPruneCounter = 0;
        if (!container || !container.IsValid()) return;
        if (!purchases) purchases = container.FindChildrenWithClassTraverse("recentPurchase");
        var valid = {};
        for (var i = 0; i < purchases.length; i++) {
            var n = GetChildText(purchases[i], "recentModPurchaseName");
            var t = GetChildText(purchases[i], "recentTimePurchased");
            var h = GetChildText(purchases[i], "recentModPurchaserHero");
            if (n && t) valid[n + "|" + t + "|" + h] = true;
        }
        quickSeenKeys = valid;
    }

    // ─── Hideout reset ────────────────────────────────────────────────────────────

    function IsConnectedToHideout(globalRoot) {
        try {
            if (typeof Game !== "undefined" && Game.GetMapInfo) {
                var mapName = Game.GetMapInfo().map_display_name;
                if (["hero_testing_hideout", "hideout", "dl_hideout"].indexOf(mapName) !== -1) return true;
            }
        } catch (e) { }
        var hud = globalRoot.FindChildTraverse("Hud");
        if (hud && (hud.BHasClass("connectedToHideout") || hud.BHasClass("InHideout"))) return true;
        return globalRoot.BHasClass("connectedToHideout") || globalRoot.BHasClass("InHideout");
    }

    function ClearContainer(globalRoot) {
        var container = GetContainer(globalRoot);
        if (container && container.IsValid()) {
            var count = container.GetChildCount();
            if (count > 0) {
                for (var i = 0; i < count; i++) container.GetChild(i).DeleteAsync(0);
                if (DEBUG) $.Msg("[HideoutMonitor] Deleted " + count + " children.");
            }
        }
        quickSeenKeys = {};
        quickInitialized = false;
        ResetHeroMap();
    }

    // ─── Quick purchases overlay ──────────────────────────────────────────────────

    function ResetHeroMap() {
        _heroMapBuildGeneration++;
        for (var hero in quickPanelsByHero) {
            var panel = quickPanelsByHero[hero];
            if (panel && panel.IsValid()) panel.DeleteAsync(0);
        }
        heroNameMap = {};
        heroMapState = HERO_MAP_IDLE;
        quickPanelsByHero = {};
        quickActiveEntriesByHero = {};
        if (DEBUG_QUICK) $.Msg("[QuickPurchases] Hero map reset — will rebuild next poll.");
    }

    function IsHeroMapStale() {
        if (heroMapState !== HERO_MAP_BUILT) return false;
        for (var hero in heroNameMap) {
            var pp = heroNameMap[hero];
            if (!pp || !pp.IsValid()) {
                if (DEBUG_QUICK) $.Msg("[QuickPurchases] Stale map detected: panel for '" + hero + "' is invalid.");
                return true;
            }
        }
        return false;
    }

    function BuildHeroNameMap() {
        if (heroMapState === HERO_MAP_BUILDING) return;
        heroMapState = HERO_MAP_BUILDING;
        _heroMapBuildGeneration++;
        var buildGen = _heroMapBuildGeneration;
        try {
            var globalRoot = GetAbsoluteRoot();
            var labels = globalRoot.FindChildrenWithClassTraverse("HeroNameHidden");
            if (!labels || labels.length === 0) {
                if (DEBUG_QUICK) $.Msg("[QuickPurchases] BuildHeroNameMap: no .HeroNameHidden labels found.");
                heroMapState = HERO_MAP_IDLE;
                return;
            }
            if (DEBUG_QUICK) $.Msg("[QuickPurchases] BuildHeroNameMap: found " + labels.length + " label(s), resolving...");
            var pending = labels.length;
            function onDone() {
                if (_heroMapBuildGeneration !== buildGen) return;
                pending--;
                if (pending === 0) {
                    heroMapState = HERO_MAP_BUILT;
                    if (DEBUG_QUICK) {
                        var keys = [];
                        for (var k in heroNameMap) keys.push(k);
                        $.Msg("[QuickPurchases] BuildHeroNameMap: done. Heroes mapped: [" + keys.join(", ") + "]");
                    }
                }
            }
            for (var i = 0; i < labels.length; i++) {
                (function (label) {
                    var playerPanel = label.GetParent();
                    var badge = null;
                    while (playerPanel && playerPanel.IsValid()) {
                        badge = playerPanel.FindChildTraverse("HeroBadge");
                        if (badge) break;
                        playerPanel = playerPanel.GetParent();
                    }
                    if (!badge || !playerPanel) {
                        if (DEBUG_QUICK) $.Msg("[QuickPurchases] BuildHeroNameMap: label has no HeroBadge ancestor, skipping.");
                        onDone(); return;
                    }
                    var heroId = badge.heroid;
                    if (DEBUG_QUICK) $.Msg("[QuickPurchases] BuildHeroNameMap: badge found, heroid=" + heroId + " (type=" + typeof heroId + ")");
                    if (typeof heroId !== "number" || heroId <= 0) {
                        if (DEBUG_QUICK) $.Msg("[QuickPurchases] BuildHeroNameMap: invalid heroid, skipping.");
                        onDone(); return;
                    }
                    playerPanel.SetDialogVariableInt("hero_id", heroId);
                    (function (pp, hid, lbl, gen) {
                        $.Schedule(0.3, function () {
                            if (heroMapState !== HERO_MAP_BUILDING) return;
                            if (_heroMapBuildGeneration !== gen) return;
                            if (!lbl.IsValid()) { onDone(); return; }
                            var name = lbl.text.trim().toUpperCase();
                            if (name) {
                                heroNameMap[name] = pp;
                                if (DEBUG_QUICK) $.Msg("[QuickPurchases] BuildHeroNameMap: mapped '" + name + "' (heroid=" + hid + ")");
                            }
                            onDone();
                        });
                    })(playerPanel, heroId, label, buildGen);
                })(labels[i]);
            }
        } catch (e) {
            heroMapState = HERO_MAP_IDLE;
            $.Msg("[QuickPurchases] BuildHeroNameMap ERROR: " + e);
        }
    }

    function GetOrCreateQuickPanelForHero(heroNameUpper) {
        if (quickPanelsByHero[heroNameUpper] && quickPanelsByHero[heroNameUpper].IsValid()) {
            return quickPanelsByHero[heroNameUpper];
        }
        var playerPanel = heroNameMap[heroNameUpper];
        if (!playerPanel || !playerPanel.IsValid()) {
            if (DEBUG_QUICK) {
                var _keys = [];
                for (var _k in heroNameMap) _keys.push(_k);
                $.Msg("[QuickPurchases] GetOrCreateQuickPanelForHero: no valid player panel for '" + heroNameUpper + "'. Map keys: [" + _keys.join(", ") + "]. Triggering rebuild.");
            }
            if (heroMapState !== HERO_MAP_BUILDING) {
                heroMapState = HERO_MAP_IDLE;
            }
            return null;
        }
        var panel = $.CreatePanel("Panel", playerPanel, "");
        panel.AddClass("QuickPurchasesPanel");
        quickPanelsByHero[heroNameUpper] = panel;
        if (DEBUG_QUICK) $.Msg("[QuickPurchases] Created QuickPurchasesPanel for '" + heroNameUpper + "'.");
        return panel;
    }

    function GetPanelLeftInTopBar(panel) {
        var topBar = GetAbsoluteRoot().FindChildTraverse("TopBar");
        var x = 0;
        var current = panel;
        while (current && current.IsValid() && current !== topBar) {
            x += current.actualxoffset;
            current = current.GetParent();
        }
        return x;
    }

    var _overlapResolvePending = false;
    var _overlapResolveTimestamp = 0;
    function ScheduleResolveOverlaps(delay) {
        if (_overlapResolvePending && _overlapResolveTimestamp > $.FrameTime()) return;
        _overlapResolvePending = true;
        _overlapResolveTimestamp = $.FrameTime() + (delay || 0) + 5.0;
        $.Schedule(delay || 0, function () {
            try {
                ResolveOverlaps();
            } finally {
                _overlapResolvePending = false;
                _overlapResolveTimestamp = 0;
            }
        });
    }

    function ResolveOverlaps() {
        // Collect every individual entry across all heroes
        var all = [];
        for (var hero in quickPanelsByHero) {
            var panel = quickPanelsByHero[hero];
            if (!panel || !panel.IsValid()) continue;
            var entries = quickActiveEntriesByHero[hero];
            if (!entries || entries.length === 0) continue;
            for (var e = 0; e < entries.length; e++) {
                var entry = entries[e];
                if (!entry || !entry.IsValid()) continue;
                // entryTime: reverse index so newest (highest index) sorts first
                all.push({ hero: hero, entry: entry, panel: panel, idx: e });
            }
        }

        // Reset panel base margins.  Entries will be positioned relative to
        // the panel's marginTop; the panel itself sits at its base offset.
        for (var h in quickPanelsByHero) {
            var pp = quickPanelsByHero[h];
            if (!pp || !pp.IsValid()) continue;
            var base = 125;
            var parent = pp.GetParent();
            if (parent && parent.IsValid() && parent.BHasClass("UltimateUnlocked")) base = 152;
            pp.style.marginTop = base + "px";
        }

        if (all.length === 0) return;

        // Sort entries newest-first by their index within the hero's array
        // (higher index = appended later = newer).  Stable: same-idx across
        // different heroes keeps insertion order.
        for (var _si = 0; _si < all.length - 1; _si++) {
            for (var _sj = _si + 1; _sj < all.length; _sj++) {
                if (all[_sj].idx > all[_si].idx) {
                    var _tmp = all[_si]; all[_si] = all[_sj]; all[_sj] = _tmp;
                }
            }
        }

        // Cache per-panel X/w — all entries from the same hero share a panel
        var _panelCache = {};
        for (var i = 0; i < all.length; i++) {
            var _hero = all[i].hero;
            if (!_panelCache[_hero]) {
                _panelCache[_hero] = {
                    x: GetPanelLeftInTopBar(all[i].panel),
                    w: all[i].panel.actuallayoutwidth
                };
            }
            all[i].x = _panelCache[_hero].x;
            all[i].w = _panelCache[_hero].w;
            // Divide by the parent panel's scale to cancel the entry's own
            // ui-scale.  parent.actualuiscale_y: 1.0 at 1080p, 1.48 at 1600p.
            all[i].h = all[i].entry.contentheight / all[i].panel.actualuiscale_y;
        }

        // For each entry, find the tallest overlapping entry above it and
        // push it down.  Entries from the same panel always overlap.
        for (var i = 0; i < all.length; i++) {
            var offset = 0;
            for (var j = 0; j < i; j++) {
                if (all[j].w <= 0) continue;
                var sameHero = (all[i].hero === all[j].hero);
                var jLeft = all[j].x;
                var jRight = jLeft + all[j].w;
                var iLeft = all[i].x;
                var iRight = iLeft + all[i].w;
                if (sameHero || (iLeft < jRight && iRight > jLeft)) {
                    var needed = all[j]._margin + all[j].h;
                    if (needed > offset) offset = needed;
                }
            }
            all[i]._margin = offset;
            all[i].entry.style.marginTop = offset + "px";
        }
    }

    function QuickRemoveEntry(entry, heroNameUpper) {
        var arr = quickActiveEntriesByHero[heroNameUpper];
        if (arr) quickActiveEntriesByHero[heroNameUpper] = ArrayRemove(arr, entry);
        if (!entry.IsValid()) return;
        entry.AddClass("quickFading");
        var entryParent = entry.GetParent();
        $.Schedule(QUICK_FADE_DURATION, function () {
            if (entry.IsValid() && entryParent.IsValid()) entry.DeleteAsync(0);
            ScheduleResolveOverlaps(0);
        });
    }

    function QuickEvictEntry(entry, heroNameUpper) {
        var arr = quickActiveEntriesByHero[heroNameUpper];
        if (arr) quickActiveEntriesByHero[heroNameUpper] = ArrayRemove(arr, entry);
        if (entry.IsValid()) entry.DeleteAsync(0);
        ScheduleResolveOverlaps(0);
    }

    function AddQuickEntry(sourcePurchase, nameText) {
        var heroNameUpper = GetChildText(sourcePurchase, "recentModPurchaserHero").toUpperCase();
        if (DEBUG_QUICK) $.Msg("[QuickPurchases] AddQuickEntry: item='" + nameText + "' hero='" + heroNameUpper + "'");
        var quickPanel = GetOrCreateQuickPanelForHero(heroNameUpper);
        if (!quickPanel) {
            if (DEBUG_QUICK) $.Msg("[QuickPurchases] AddQuickEntry: no panel for '" + heroNameUpper + "', dropping entry.");
            return false;
        }

        if (!quickActiveEntriesByHero[heroNameUpper]) quickActiveEntriesByHero[heroNameUpper] = [];

        if (quickActiveEntriesByHero[heroNameUpper].length >= QUICK_MAX_ENTRIES) {
            QuickEvictEntry(quickActiveEntriesByHero[heroNameUpper][0], heroNameUpper);
        }

        var entry = $.CreatePanel("Panel", quickPanel, "");
        entry.AddClass("quickPurchase");

        for (var i = 0; i < QUICK_CLASSES_TO_COPY.length; i++) {
            if (sourcePurchase.BHasClass(QUICK_CLASSES_TO_COPY[i])) {
                entry.AddClass(QUICK_CLASSES_TO_COPY[i]);
            }
        }

        // Item info panel — item icon + item name
        var itemInfo = $.CreatePanel("Panel", entry, "");
        itemInfo.AddClass("quickItemInfo");

        var iconUrl = _MOD_ICONS[nameText];
        if (iconUrl) {
            var icon = $.CreatePanel("Panel", itemInfo, "");
            icon.AddClass("mod_icon");
            (function (p, url) { $.Schedule(0, function () { if (p.IsValid()) { p.style.backgroundImage = url; p.style.backgroundSize = "100% 100%"; } }); })(icon, iconUrl);
        }

        var nameLabel = $.CreatePanel("Label", itemInfo, "");
        nameLabel.AddClass("quickPurchaseName");
        nameLabel.text = nameText;

        quickActiveEntriesByHero[heroNameUpper].push(entry);

        // Delay slightly so the panel has a layout pass before we read its dimensions
        ScheduleResolveOverlaps(0.05);

        (function (e, h) {
            $.Schedule(QUICK_DISPLAY_DURATION, function () {
                if (e.IsValid()) QuickRemoveEntry(e, h);
            });
        })(entry, heroNameUpper);
        return true;
    }

    function UpdateQuickPurchases(container, purchases) {
        if (heroMapState !== HERO_MAP_BUILT) {
            if (DEBUG_QUICK && heroMapState !== HERO_MAP_BUILDING) $.Msg("[QuickPurchases] UpdateQuickPurchases: waiting for hero map...");
            return;
        }
        if (!container || !container.IsValid()) return;
        if (!quickInitialized) return;

        if (!purchases) purchases = container.FindChildrenWithClassTraverse("recentPurchase");

        for (var i = 0; i < purchases.length; i++) {
            var purchase = purchases[i];
            if (!purchase || !purchase.IsValid()) continue;
            var name = GetChildText(purchase, "recentModPurchaseName");
            var time = GetChildText(purchase, "recentTimePurchased");
            var hero = GetChildText(purchase, "recentModPurchaserHero");
            if (!name || !time) continue;

            var key = name + "|" + time + "|" + hero;
            if (!quickSeenKeys[key]) {
                if (!purchase.BHasClass("filterHidden")) {
                    // Only seal the key if AddQuickEntry succeeds —
                    // a hero not yet in the map should retry next tick.
                    if (AddQuickEntry(purchase, name)) {
                        quickSeenKeys[key] = true;
                    }
                } else {
                    quickSeenKeys[key] = true;
                }
            }
        }
    }

    // ─── Poll loops ───────────────────────────────────────────────────────────────

    function MainPoll() {
        try {
            var globalRoot = GetAbsoluteRoot();
            var container = GetContainer(globalRoot);
            // Fetch purchases once per tick to avoid redundant tree walks
            var purchases = container && container.IsValid() ? container.FindChildrenWithClassTraverse("recentPurchase") : [];
            UpdateModIcons(container, purchases);
            var ctx = BuildContext(container);
            CreateFilterCheckboxes(globalRoot);
            UpdateFilterVisibility(globalRoot, ctx);
            CapContainer(container);
            ApplyFilters(container, ctx, purchases);
            if (IsHeroMapStale()) ResetHeroMap();
            // Seed quickSeenKeys before the first hero-map build, so pre-existing
            // purchases are suppressed but purchases that arrive during/after the
            // build get popups once the map is ready.
            if (!quickInitialized) {
                for (var _si = 0; _si < purchases.length; _si++) {
                    var _sp = purchases[_si];
                    if (!_sp || !_sp.IsValid()) continue;
                    var _sn = GetChildText(_sp, "recentModPurchaseName");
                    var _st = GetChildText(_sp, "recentTimePurchased");
                    var _sh = GetChildText(_sp, "recentModPurchaserHero");
                    if (_sn && _st) quickSeenKeys[_sn + "|" + _st + "|" + _sh] = true;
                }
                quickInitialized = true;
            }
            if (heroMapState !== HERO_MAP_BUILT) BuildHeroNameMap();
            if (!wasInHideout) {
                UpdateQuickPurchases(container, purchases);
                PruneSeenKeys(container, purchases);
            }
        } catch (e) {
            _errorCounter++;
            var msg = "[MainPoll] ERROR: " + e;
            if (msg !== _lastErrorMessage || _errorCounter % 50 === 0) {
                $.Warning(msg);
                _lastErrorMessage = msg;
            }
        }
        $.Schedule(MAIN_POLL_INTERVAL, MainPoll);
    }

    function HideoutPoll() {
        try {
            var globalRoot = GetAbsoluteRoot();
            var isInHideout = IsConnectedToHideout(globalRoot);
            if (wasInHideout !== null && isInHideout !== wasInHideout) {
                ClearContainer(globalRoot);
            }
            wasInHideout = isInHideout;
        } catch (e) {
            $.Warning("[HideoutPoll] ERROR: " + e);
        }
        $.Schedule(HIDEOUT_POLL_INTERVAL, HideoutPoll);
    }


    MainPoll();
    HideoutPoll();
})();
