/**
 * ============================================================================
 * Quick Actions Studio & Permutations Controller (Modular)
 * ============================================================================
 * Manages custom Quick Actions, arbitrary permutations & combinations across
 * any registered smart home device, real-time live preview summaries, and
 * synchronization with the primary Dashboard and Settings Studio.
 */

(function () {
    "use strict";

    // Default Fallback Quick Actions Presets
    const defaultQuickActions = [
        {
            id: "all-off",
            name: "All Off",
            icon: "power_settings_new",
            behavior: "all-off",
            active: true,
            description: "Turn off all devices in current room",
            customConfig: {
                targetDevices: []
            }
        },
        {
            id: "all-on",
            name: "All On",
            icon: "wb_sunny",
            behavior: "all-on",
            active: true,
            description: "Turn on all devices in current room",
            customConfig: {
                targetDevices: []
            }
        },
        {
            id: "eco",
            name: "Eco Mode",
            icon: "eco",
            behavior: "eco",
            active: true,
            description: "Low power draw for optimal efficiency",
            customConfig: {
                targetDevices: []
            }
        },
        {
            id: "fan-timer",
            name: "Fan +1h",
            icon: "timer",
            behavior: "fan-timer",
            active: true,
            description: "Run ceiling fan for 1 hour",
            customConfig: {
                targetDevices: []
            }
        },
        {
            id: "movie-night",
            name: "Movie Night",
            icon: "movie",
            behavior: "movie-night",
            active: false,
            description: "TV on, ambient lights dimmed",
            customConfig: {
                targetDevices: []
            }
        },
        {
            id: "bedtime",
            name: "Bedtime Cozy",
            icon: "bedtime",
            behavior: "bedtime",
            active: false,
            description: "Fan on, all lights and entertainment off",
            customConfig: {
                targetDevices: []
            }
        }
    ];

    // Helper to access shared dashboard state
    const getState = () => {
        const d = window.Dashboard || {};
        return {
            devices: d.devices || [],
            rooms: d.rooms || [],
            currentRoom: d.currentRoom || "bed",
            settingsData: d.settingsData || {},
            showToast: d.showToast || ((msg) => console.log("[Toast]", msg)),
            syncDevicesAnimated: (devs) => {
                if (typeof d.syncDevicesAnimated === "function") {
                    d.syncDevicesAnimated(devs);
                } else if (typeof d.renderDevices === "function") {
                    d.renderDevices();
                }
            },
            refreshDevices: async () => {
                if (typeof d.fetchDevices === "function") await d.fetchDevices();
                if (typeof d.renderDevices === "function") d.renderDevices();
                if (typeof d.updateActiveCount === "function") d.updateActiveCount();
            }
        };
    };

    const getActionsList = () => {
        const { settingsData } = getState();
        if (settingsData && Array.isArray(settingsData.quickActions) && settingsData.quickActions.length > 0) {
            return settingsData.quickActions;
        }
        return defaultQuickActions;
    };

    const saveActionsList = async (actionsList) => {
        const { settingsData } = getState();
        if (settingsData) {
            settingsData.quickActions = actionsList;
        }
        try {
            await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ section: "quickActions", data: actionsList })
            });
        } catch (err) {
            console.error("Failed to persist quick actions:", err);
        }
    };

    // Device icon mapper
    const getDeviceIcon = (type) => {
        switch (type) {
            case "light": return "lightbulb";
            case "fan": return "mode_fan";
            case "tv": return "tv";
            case "socket": return "power";
            case "ac": return "ac_unit";
            default: return "devices";
        }
    };

    // ========================================================================
    // 1. Settings Sub-Section: Quick Actions Studio
    // ========================================================================
    const renderSettingsStudio = () => {
        const detailPane = document.getElementById("settings-detail-pane");
        if (!detailPane) return;

        const actionsList = getActionsList();

        detailPane.innerHTML = `
            <div class="settings-section-header">
                <div class="settings-header-left">
                    <div class="settings-pane-icon">
                        <span class="material-symbols-outlined">bolt</span>
                    </div>
                    <div class="settings-header-titles">
                        <h2>Quick Actions Studio</h2>
                        <p>Create, customize, and toggle shortcuts displayed on the primary Dashboard</p>
                    </div>
                </div>
                <button type="button" class="btn-manage-primary" id="open-add-qa-btn">
                    <span class="material-symbols-outlined">add</span>
                    <span>Create Action</span>
                </button>
            </div>

            <div class="quick-actions-config-grid">
                ${actionsList.length === 0 ? `
                    <div class="empty-room-state" style="grid-column: 1 / -1; padding: 2.5rem 1rem;">
                        <div class="empty-state-icon-wrap">
                            <span class="material-symbols-outlined">bolt</span>
                        </div>
                        <p class="empty-room-text">No quick actions configured yet. Click "Create Action" above to add one.</p>
                    </div>
                ` : actionsList.map(action => `
                    <div class="qa-config-card ${action.active ? 'is-active' : ''}">
                        <div class="qa-config-left">
                            <div class="qa-avatar-badge">
                                <span class="material-symbols-outlined">${action.icon || 'bolt'}</span>
                            </div>
                            <div class="qa-titles">
                                <span class="qa-name">${action.name}</span>
                                <span class="qa-desc">${action.description || (action.active ? 'Visible on Dashboard' : 'Hidden from Dashboard')}</span>
                            </div>
                        </div>
                        <div class="qa-config-right">
                            <button type="button" class="qa-action-icon-btn btn-edit-qa" data-id="${action.id}" title="Edit Action">
                                <span class="material-symbols-outlined">edit</span>
                            </button>
                            <button type="button" class="qa-action-icon-btn btn-delete-qa" data-id="${action.id}" title="Delete Action">
                                <span class="material-symbols-outlined">delete</span>
                            </button>
                            <label class="normal-switch" title="Show on Dashboard">
                                <input type="checkbox" class="qa-toggle-chk" data-id="${action.id}" ${action.active ? 'checked' : ''}>
                                <span class="normal-slider"></span>
                            </label>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        // Attach Add Button
        const addBtn = document.getElementById("open-add-qa-btn");
        if (addBtn) {
            addBtn.addEventListener("click", () => openModal());
        }

        // Attach Edit Buttons
        detailPane.querySelectorAll(".btn-edit-qa").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const act = actionsList.find(a => a.id === id);
                if (act) openModal(act);
            });
        });

        // Attach Delete Buttons
        detailPane.querySelectorAll(".btn-delete-qa").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const act = actionsList.find(a => a.id === id);
                const { showToast } = getState();
                const confirmFn = window.showConfirmDialog || (window.Dashboard && window.Dashboard.showConfirmDialog);
                let confirmed = false;
                if (confirmFn) {
                    confirmed = await confirmFn({
                        title: `Delete "${act ? act.name : 'Action'}"?`,
                        message: "This shortcut will be permanently removed from your dashboard.",
                        confirmText: "Delete",
                        cancelText: "Cancel",
                        isDestructive: true,
                        icon: "delete"
                    });
                } else {
                    confirmed = window.confirm(`Are you sure you want to delete "${act ? act.name : 'this action'}"?`);
                }
                if (confirmed) {
                    const updated = actionsList.filter(a => a.id !== id);
                    await saveActionsList(updated);
                    showToast(`Quick Action "${act ? act.name : ''}" deleted`, "delete");
                    renderSettingsStudio();
                    renderDashboardGrid();
                }
            });
        });

        // Attach Dashboard Visibility Toggles
        detailPane.querySelectorAll(".qa-toggle-chk").forEach(chk => {
            chk.addEventListener("change", async () => {
                const id = chk.dataset.id;
                const act = actionsList.find(a => a.id === id);
                const card = chk.closest(".qa-config-card");
                const { showToast } = getState();
                if (act) {
                    act.active = chk.checked;
                    if (card) {
                        card.classList.toggle("is-active", act.active);
                        const descEl = card.querySelector(".qa-desc");
                        if (descEl && !act.description) {
                            descEl.textContent = act.active ? "Visible on Dashboard" : "Hidden from Dashboard";
                        }
                    }
                    await saveActionsList(actionsList);
                    showToast(`Quick Action "${act.name}" ${act.active ? 'enabled' : 'hidden'}`, "success");
                    renderDashboardGrid();
                }
            });
        });
    };

    // ========================================================================
    // 2. Primary Dashboard Quick Actions Grid
    // ========================================================================
    const renderDashboardGrid = () => {
        const grid = document.getElementById("quick-actions-grid");
        if (!grid) return;

        const actionsList = getActionsList();
        const activeActions = actionsList.filter(a => a.active);

        if (activeActions.length === 0) {
            grid.innerHTML = `<span style="font-size: 0.75rem; color: var(--color-text-secondary); grid-column: 1 / -1; text-align: center; padding: 0.5rem;">No active shortcuts. Enable them in Settings.</span>`;
            return;
        }

        grid.innerHTML = activeActions.map(action => `
            <button type="button" class="action-pill" data-action="${action.id}">
                <span class="material-symbols-outlined action-icon">${action.icon || 'bolt'}</span>
                <span class="action-text">${action.name}</span>
            </button>
        `).join("");

        grid.querySelectorAll(".action-pill").forEach(btn => {
            btn.addEventListener("click", async () => {
                btn.classList.add("active");
                const actionId = btn.dataset.action;
                const { currentRoom, showToast, refreshDevices, syncDevicesAnimated } = getState();

                btn.style.transform = "scale(0.95)";
                setTimeout(() => { btn.style.transform = ""; }, 150);

                try {
                    const res = await fetch("/api/actions/execute", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: actionId, roomId: currentRoom })
                    });
                    const data = await res.json();
                    if (data.success) {
                        showToast(data.message, "bolt");
                        if (Array.isArray(data.devices)) {
                            syncDevicesAnimated(data.devices);
                        } else {
                            await refreshDevices();
                        }
                    } else {
                        showToast(data.error || "Action could not be executed", "warning", true);
                    }
                } catch (err) {
                    console.error("Quick action execution error:", err);
                    showToast("Server connection error during quick action", "error", true);
                }

                setTimeout(() => {
                    btn.classList.remove("active");
                }, 600);
            });
        });

        if (!grid.dataset.wheelBound) {
            grid.dataset.wheelBound = "true";
            grid.addEventListener("wheel", (e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    e.preventDefault();
                    grid.scrollLeft += e.deltaY;
                }
            }, { passive: false });
        }
    };

    // ========================================================================
    // 3. Dynamic Device Permutations Builder in Modal
    // ========================================================================
    const buildDeviceMatrix = (actionToEdit) => {
        const container = document.getElementById("qa-device-matrix");
        if (!container) return;

        const { devices } = getState();
        if (!devices || devices.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 1.5rem; color: #86868b; font-size: 0.8rem;">
                    No hardware devices registered in the system yet.
                </div>
            `;
            return;
        }

        // Map existing rules if editing
        const existingTargets = (actionToEdit && actionToEdit.customConfig && actionToEdit.customConfig.targetDevices) || [];
        const existingMap = {};
        existingTargets.forEach(t => {
            existingMap[t.deviceId] = t;
        });

        // If no customConfig but predefined behavior exists, map it sensibly
        if (existingTargets.length === 0 && actionToEdit && actionToEdit.behavior) {
            const beh = actionToEdit.behavior;
            devices.forEach(d => {
                if (beh === "all-off") {
                    existingMap[d.id] = { action: "off" };
                } else if (beh === "all-on") {
                    const target = { action: "on" };
                    if (d.type === "light" && d.dimmable !== false) target.brightness = 100;
                    else if (d.type === "fan") target.speed = 3;
                    else if (d.type === "ac") { target.temperature = 22; target.acMode = "cool"; }
                    existingMap[d.id] = target;
                } else if (beh === "eco") {
                    if (d.type === "tv" || d.type === "socket") existingMap[d.id] = { action: "off" };
                    else if (d.type === "fan") existingMap[d.id] = { action: "on", speed: 1 };
                    else if (d.type === "light") existingMap[d.id] = { action: "on", brightness: 30 };
                    else if (d.type === "ac") existingMap[d.id] = { action: "on", temperature: 25, acMode: "eco" };
                } else if (beh === "movie-night") {
                    if (d.type === "light") existingMap[d.id] = { action: "off" };
                    if (d.type === "tv") existingMap[d.id] = { action: "on" };
                    if (d.type === "ac") existingMap[d.id] = { action: "on", temperature: 23, acMode: "cool" };
                } else if (beh === "bedtime") {
                    if (d.type === "light" || d.type === "tv" || d.type === "socket") existingMap[d.id] = { action: "off" };
                    if (d.type === "fan") existingMap[d.id] = { action: "on", speed: 2 };
                    if (d.type === "ac") existingMap[d.id] = { action: "on", temperature: 24, acMode: "cool" };
                } else if (beh === "fan-timer") {
                    if (d.type === "fan") existingMap[d.id] = { action: "on", speed: 3 };
                }
            });
        }

        container.innerHTML = devices.map(device => {
            const rule = existingMap[device.id] || { action: "ignore" };
            const action = rule.action || "ignore";
            const brightness = rule.brightness !== undefined ? rule.brightness : (device.brightness || 80);
            const speed = rule.speed !== undefined ? rule.speed : (device.speed || 3);
            const temperature = rule.temperature !== undefined ? rule.temperature : (device.temperature || 22);
            const acMode = rule.acMode || rule.mode || device.mode || "cool";
            const isLight = device.type === "light";
            const isFan = device.type === "fan";
            const isAc = device.type === "ac";

            return `
                <div class="qa-device-row state-${action}" data-device-id="${device.id}" data-type="${device.type}">
                    <div class="qa-device-row-main">
                        <div class="qa-device-info">
                            <div class="qa-device-icon-badge">
                                <span class="material-symbols-outlined">${getDeviceIcon(device.type)}</span>
                            </div>
                            <div class="qa-device-labels">
                                <span class="qa-device-name">${device.name}</span>
                                <span class="qa-room-tag">${device.room}</span>
                            </div>
                        </div>
                        <div class="qa-segmented-actions">
                            <button type="button" class="qa-seg-btn ${action === 'ignore' ? 'is-selected' : ''}" data-action="ignore">Ignore</button>
                            <button type="button" class="qa-seg-btn ${action === 'on' ? 'is-selected' : ''}" data-action="on">Turn ON</button>
                            <button type="button" class="qa-seg-btn ${action === 'off' ? 'is-selected' : ''}" data-action="off">Turn OFF</button>
                            <button type="button" class="qa-seg-btn ${action === 'toggle' ? 'is-selected' : ''}" data-action="toggle">Toggle</button>
                        </div>
                    </div>

                    ${isLight && device.dimmable ? `
                        <div class="qa-device-sub-settings qa-light-settings" style="display: ${action === 'on' ? 'flex' : 'none'};">
                            <span>Brightness:</span>
                            <input type="range" class="qa-brightness-slider" min="10" max="100" step="5" value="${brightness}">
                            <span class="qa-slider-val">${brightness}%</span>
                        </div>
                    ` : ''}

                    ${isFan ? `
                        <div class="qa-device-sub-settings qa-fan-settings" style="display: ${action === 'on' ? 'flex' : 'none'};">
                            <span>Fan Speed:</span>
                            <div class="qa-speed-pills">
                                <button type="button" class="qa-speed-btn ${speed === 1 ? 'is-active' : ''}" data-speed="1">1 (Eco)</button>
                                <button type="button" class="qa-speed-btn ${speed === 2 ? 'is-active' : ''}" data-speed="2">2 (Med)</button>
                                <button type="button" class="qa-speed-btn ${speed === 3 ? 'is-active' : ''}" data-speed="3">3 (Max)</button>
                            </div>
                        </div>
                    ` : ''}

                    ${isAc ? `
                        <div class="qa-device-sub-settings qa-ac-settings" style="display: ${action === 'on' ? 'flex' : 'none'};">
                            <span>Target Temp:</span>
                            <input type="range" class="qa-brightness-slider qa-ac-temp-slider" min="16" max="30" step="1" value="${temperature}">
                            <span class="qa-slider-val qa-ac-temp-val">${temperature}°C</span>
                            <div class="qa-speed-pills qa-ac-modes">
                                <button type="button" class="qa-speed-btn ${acMode === 'cool' ? 'is-active' : ''}" data-mode="cool">Cool</button>
                                <button type="button" class="qa-speed-btn ${acMode === 'eco' ? 'is-active' : ''}" data-mode="eco">Eco</button>
                                <button type="button" class="qa-speed-btn ${acMode === 'heat' ? 'is-active' : ''}" data-mode="heat">Heat</button>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join("");

        // Attach segmented click listeners for each device row
        container.querySelectorAll(".qa-device-row").forEach(row => {
            const segBtns = row.querySelectorAll(".qa-seg-btn");
            const lightSettings = row.querySelector(".qa-light-settings");
            const fanSettings = row.querySelector(".qa-fan-settings");
            const acSettings = row.querySelector(".qa-ac-settings");
            const lightSlider = row.querySelector(".qa-light-settings .qa-brightness-slider");
            const lightSliderVal = row.querySelector(".qa-light-settings .qa-slider-val");
            const acSlider = row.querySelector(".qa-ac-temp-slider");
            const acSliderVal = row.querySelector(".qa-ac-temp-val");
            const speedBtns = row.querySelectorAll(".qa-fan-settings .qa-speed-btn");
            const acModeBtns = row.querySelectorAll(".qa-ac-modes .qa-speed-btn");

            segBtns.forEach(btn => {
                btn.addEventListener("click", () => {
                    segBtns.forEach(b => b.classList.remove("is-selected"));
                    btn.classList.add("is-selected");
                    const act = btn.dataset.action;

                    // Update row classes
                    row.classList.remove("state-ignore", "state-on", "state-off", "state-toggle");
                    row.classList.add(`state-${act}`);

                    // Show/hide sub-settings
                    if (lightSettings) lightSettings.style.display = act === "on" ? "flex" : "none";
                    if (fanSettings) fanSettings.style.display = act === "on" ? "flex" : "none";
                    if (acSettings) acSettings.style.display = act === "on" ? "flex" : "none";

                    updatePreviewSummary();
                });
            });

            if (lightSlider && lightSliderVal) {
                lightSlider.addEventListener("input", () => {
                    lightSliderVal.textContent = `${lightSlider.value}%`;
                    updatePreviewSummary();
                });
            }

            if (acSlider && acSliderVal) {
                acSlider.addEventListener("input", () => {
                    acSliderVal.textContent = `${acSlider.value}°C`;
                    updatePreviewSummary();
                });
            }

            if (speedBtns) {
                speedBtns.forEach(sBtn => {
                    sBtn.addEventListener("click", () => {
                        speedBtns.forEach(b => b.classList.remove("is-active"));
                        sBtn.classList.add("is-active");
                        updatePreviewSummary();
                    });
                });
            }

            if (acModeBtns) {
                acModeBtns.forEach(mBtn => {
                    mBtn.addEventListener("click", () => {
                        acModeBtns.forEach(b => b.classList.remove("is-active"));
                        mBtn.classList.add("is-active");
                        updatePreviewSummary();
                    });
                });
            }
        });

        updatePreviewSummary();
    };

    // Update live rule summary text
    const updatePreviewSummary = () => {
        const container = document.getElementById("qa-device-matrix");
        const previewEl = document.getElementById("qa-preview-text");
        if (!container || !previewEl) return;

        const changes = [];
        container.querySelectorAll(".qa-device-row").forEach(row => {
            const selectedBtn = row.querySelector(".qa-seg-btn.is-selected");
            if (!selectedBtn) return;
            const action = selectedBtn.dataset.action;
            if (action === "ignore") return;

            const nameEl = row.querySelector(".qa-device-name");
            const name = nameEl ? nameEl.textContent : "Device";

            if (action === "on") {
                const lightSlider = row.querySelector(".qa-light-settings .qa-brightness-slider");
                const activeSpeed = row.querySelector(".qa-fan-settings .qa-speed-btn.is-active");
                const acSlider = row.querySelector(".qa-ac-temp-slider");
                const activeAcMode = row.querySelector(".qa-ac-modes .qa-speed-btn.is-active");
                const lightSet = row.querySelector(".qa-light-settings");
                const fanSet = row.querySelector(".qa-fan-settings");
                const acSet = row.querySelector(".qa-ac-settings");

                if (lightSlider && lightSet && lightSet.style.display !== "none") {
                    changes.push(`Turn ON ${name} (${lightSlider.value}%)`);
                } else if (activeSpeed && fanSet && fanSet.style.display !== "none") {
                    changes.push(`Turn ON ${name} (Speed ${activeSpeed.dataset.speed})`);
                } else if (acSlider && acSet && acSet.style.display !== "none") {
                    const m = activeAcMode ? activeAcMode.dataset.mode.toUpperCase() : "COOL";
                    changes.push(`Turn ON ${name} (${acSlider.value}°C ${m})`);
                } else {
                    changes.push(`Turn ON ${name}`);
                }
            } else if (action === "off") {
                changes.push(`Turn OFF ${name}`);
            } else if (action === "toggle") {
                changes.push(`Toggle ${name}`);
            }
        });

        if (changes.length === 0) {
            previewEl.textContent = "No device changes configured (All devices will stay as-is).";
        } else {
            previewEl.textContent = changes.join(", ");
        }
    };

    // Apply template to matrix
    const applyTemplateToMatrix = (template) => {
        const container = document.getElementById("qa-device-matrix");
        if (!container) return;

        container.querySelectorAll(".qa-device-row").forEach(row => {
            const type = row.dataset.type;
            let targetAction = "ignore";
            let targetBrightness = 80;
            let targetSpeed = 3;
            let targetTemp = 22;
            let targetAcMode = "cool";

            if (template === "all-off") {
                targetAction = "off";
            } else if (template === "all-on") {
                targetAction = "on";
                targetBrightness = 100;
                targetSpeed = 3;
                targetTemp = 22;
                targetAcMode = "cool";
            } else if (template === "eco") {
                if (type === "tv" || type === "socket") targetAction = "off";
                else if (type === "fan") { targetAction = "on"; targetSpeed = 1; }
                else if (type === "light") { targetAction = "on"; targetBrightness = 25; }
                else if (type === "ac") { targetAction = "on"; targetTemp = 25; targetAcMode = "eco"; }
            } else if (template === "movie-night") {
                if (type === "light") targetAction = "off";
                else if (type === "tv") targetAction = "on";
                else if (type === "ac") { targetAction = "on"; targetTemp = 23; targetAcMode = "cool"; }
                else targetAction = "ignore";
            } else if (template === "bedtime") {
                if (type === "fan") { targetAction = "on"; targetSpeed = 2; }
                else if (type === "ac") { targetAction = "on"; targetTemp = 24; targetAcMode = "cool"; }
                else targetAction = "off";
            } else if (template === "clear") {
                targetAction = "ignore";
            }

            // Set button state
            row.querySelectorAll(".qa-seg-btn").forEach(btn => {
                if (btn.dataset.action === targetAction) {
                    btn.classList.add("is-selected");
                } else {
                    btn.classList.remove("is-selected");
                }
            });

            // Set row state
            row.classList.remove("state-ignore", "state-on", "state-off", "state-toggle");
            row.classList.add(`state-${targetAction}`);

            // Sub-settings
            const lightSettings = row.querySelector(".qa-light-settings");
            const fanSettings = row.querySelector(".qa-fan-settings");
            const acSettings = row.querySelector(".qa-ac-settings");

            if (lightSettings) {
                lightSettings.style.display = targetAction === "on" ? "flex" : "none";
                const slider = row.querySelector(".qa-light-settings .qa-brightness-slider");
                const val = row.querySelector(".qa-light-settings .qa-slider-val");
                if (slider && val) {
                    slider.value = targetBrightness;
                    val.textContent = `${targetBrightness}%`;
                }
            }
            if (fanSettings) {
                fanSettings.style.display = targetAction === "on" ? "flex" : "none";
                row.querySelectorAll(".qa-fan-settings .qa-speed-btn").forEach(sBtn => {
                    if (sBtn.dataset.speed === String(targetSpeed)) sBtn.classList.add("is-active");
                    else sBtn.classList.remove("is-active");
                });
            }
            if (acSettings) {
                acSettings.style.display = targetAction === "on" ? "flex" : "none";
                const acSlider = row.querySelector(".qa-ac-temp-slider");
                const acVal = row.querySelector(".qa-ac-temp-val");
                if (acSlider && acVal) {
                    acSlider.value = targetTemp;
                    acVal.textContent = `${targetTemp}°C`;
                }
                row.querySelectorAll(".qa-ac-modes .qa-speed-btn").forEach(mBtn => {
                    if (mBtn.dataset.mode === targetAcMode) mBtn.classList.add("is-active");
                    else mBtn.classList.remove("is-active");
                });
            }
        });

        updatePreviewSummary();
    };

    // ========================================================================
    // 4. Modal Open & Close Controls
    // ========================================================================
    const openModal = (actionToEdit = null) => {
        const qaModal = document.getElementById("quick-action-modal");
        if (!qaModal) return;

        const title = document.getElementById("qa-modal-title");
        const idInput = document.getElementById("qa-id-input");
        const nameInput = document.getElementById("qa-name-input");
        const iconSelect = document.getElementById("qa-icon-select");
        const descInput = document.getElementById("qa-desc-input");
        const activeChk = document.getElementById("qa-active-chk");
        const submitBtn = document.getElementById("qa-modal-submit-btn");
        const presetSelect = document.getElementById("qa-preset-select");

        if (presetSelect) presetSelect.value = "";

        if (actionToEdit) {
            if (title) title.textContent = "Edit Quick Action";
            if (idInput) idInput.value = actionToEdit.id;
            if (nameInput) nameInput.value = actionToEdit.name;
            if (iconSelect) iconSelect.value = actionToEdit.icon || "bolt";
            if (descInput) descInput.value = actionToEdit.description || "";
            if (activeChk) activeChk.checked = !!actionToEdit.active;
            if (submitBtn) submitBtn.textContent = "Update Action";
        } else {
            if (title) title.textContent = "Create Quick Action";
            if (idInput) idInput.value = "";
            if (nameInput) nameInput.value = "";
            if (iconSelect) iconSelect.value = "bolt";
            if (descInput) descInput.value = "";
            if (activeChk) activeChk.checked = true;
            if (submitBtn) submitBtn.textContent = "Create Action";
        }

        buildDeviceMatrix(actionToEdit);
        qaModal.showModal();
    };

    const closeModal = () => {
        const qaModal = document.getElementById("quick-action-modal");
        const form = document.getElementById("qa-modal-form");
        if (qaModal && qaModal.open) {
            qaModal.close();
            if (form) form.reset();
        }
    };

    // ========================================================================
    // 5. Initialize Quick Actions System
    // ========================================================================
    const init = () => {
        const qaModal = document.getElementById("quick-action-modal");
        const qaModalCloseBtn = document.getElementById("qa-modal-close-btn");
        const qaModalCancelBtn = document.getElementById("qa-modal-cancel-btn");
        const qaModalForm = document.getElementById("qa-modal-form");
        const presetSelect = document.getElementById("qa-preset-select");
        const batchAllOn = document.getElementById("btn-batch-all-on");
        const batchAllOff = document.getElementById("btn-batch-all-off");
        const batchClear = document.getElementById("btn-batch-clear");

        if (qaModalCloseBtn) qaModalCloseBtn.addEventListener("click", closeModal);
        if (qaModalCancelBtn) qaModalCancelBtn.addEventListener("click", closeModal);

        if (qaModal) {
            qaModal.addEventListener("click", (e) => {
                const rect = qaModal.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                    closeModal();
                }
            });
        }

        if (presetSelect) {
            presetSelect.addEventListener("change", () => {
                if (presetSelect.value) {
                    applyTemplateToMatrix(presetSelect.value);
                }
            });
        }

        if (batchAllOn) batchAllOn.addEventListener("click", () => applyTemplateToMatrix("all-on"));
        if (batchAllOff) batchAllOff.addEventListener("click", () => applyTemplateToMatrix("all-off"));
        if (batchClear) batchClear.addEventListener("click", () => applyTemplateToMatrix("clear"));

        if (qaModalForm) {
            qaModalForm.addEventListener("submit", async (e) => {
                e.preventDefault();
                const idInput = document.getElementById("qa-id-input");
                const nameInput = document.getElementById("qa-name-input");
                const iconSelect = document.getElementById("qa-icon-select");
                const descInput = document.getElementById("qa-desc-input");
                const activeChk = document.getElementById("qa-active-chk");
                const previewEl = document.getElementById("qa-preview-text");

                const id = idInput ? idInput.value.trim() : "";
                const name = nameInput ? nameInput.value.trim() : "";
                const icon = iconSelect ? iconSelect.value : "bolt";
                const description = descInput ? descInput.value.trim() : "";
                const active = activeChk ? activeChk.checked : true;
                const summary = previewEl ? previewEl.textContent : "";

                if (!name) return;

                // Collect device permutation rules
                const targetDevices = [];
                const matrix = document.getElementById("qa-device-matrix");
                if (matrix) {
                    matrix.querySelectorAll(".qa-device-row").forEach(row => {
                        const deviceId = row.dataset.deviceId;
                        const selectedBtn = row.querySelector(".qa-seg-btn.is-selected");
                        if (!selectedBtn) return;
                        const action = selectedBtn.dataset.action;
                        if (action === "ignore") return; // Ignore unconfigured devices

                        const item = { deviceId, action };
                        const lightSet = row.querySelector(".qa-light-settings");
                        const fanSet = row.querySelector(".qa-fan-settings");
                        const acSet = row.querySelector(".qa-ac-settings");

                        if (action === "on") {
                            const slider = row.querySelector(".qa-light-settings .qa-brightness-slider");
                            const speedBtn = row.querySelector(".qa-fan-settings .qa-speed-btn.is-active");
                            const acSlider = row.querySelector(".qa-ac-temp-slider");
                            const acModeBtn = row.querySelector(".qa-ac-modes .qa-speed-btn.is-active");

                            if (slider && lightSet && lightSet.style.display !== "none") {
                                item.brightness = Number(slider.value);
                            }
                            if (speedBtn && fanSet && fanSet.style.display !== "none") {
                                item.speed = Number(speedBtn.dataset.speed);
                            }
                            if (acSlider && acSet && acSet.style.display !== "none") {
                                item.temperature = Number(acSlider.value);
                                if (acModeBtn) item.acMode = acModeBtn.dataset.mode;
                            }
                        }
                        targetDevices.push(item);
                    });
                }

                const actionsList = getActionsList();
                const { showToast } = getState();

                if (id) {
                    const existing = actionsList.find(a => a.id === id);
                    if (existing) {
                        existing.name = name;
                        existing.icon = icon;
                        existing.behavior = "custom";
                        existing.description = description || summary;
                        existing.active = active;
                        existing.customConfig = {
                            targetDevices,
                            feedbackToast: `${name} executed: ${summary}`
                        };
                    }
                } else {
                    const cleanId = name.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Date.now().toString().slice(-4);
                    actionsList.push({
                        id: cleanId,
                        name,
                        icon,
                        behavior: "custom",
                        description: description || summary,
                        active,
                        customConfig: {
                            targetDevices,
                            feedbackToast: `${name} executed: ${summary}`
                        }
                    });
                }

                await saveActionsList(actionsList);
                showToast(`Quick Action '${name}' saved!`, "bolt");
                closeModal();
                renderSettingsStudio();
                renderDashboardGrid();
            });
        }
    };

    // Expose QuickActions API globally
    window.QuickActions = {
        init,
        renderSettingsStudio,
        renderDashboardGrid,
        openModal,
        closeModal,
        getActionsList
    };

})();
