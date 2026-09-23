// ==========================================================================
// User Profile & Synchronized Avatar Management
// ==========================================================================
let currentProfile = {
    name: "Abhi",
    role: "Home Administrator",
    email: "abhi@smarthome.local",
    avatarUrl: null
};

function updateAllAvatars(avatarUrl, name, role) {
    const sidebarAvatarImg = document.getElementById("sidebar-avatar-img");
    const settingsAvatarImg = document.getElementById("settings-avatar-img");
    const settingsProfileName = document.getElementById("settings-profile-name");
    const settingsProfileRole = document.getElementById("settings-profile-role");
    const greetingTitle = document.getElementById("header-greeting-title");

    const fallbackImg = "Assets/Images/kitty.png";
    const activeAvatar = avatarUrl || fallbackImg;

    if (sidebarAvatarImg) sidebarAvatarImg.src = activeAvatar;
    if (settingsAvatarImg) settingsAvatarImg.src = activeAvatar;

    const accountLargeImg = document.getElementById("account-large-avatar-img");
    if (accountLargeImg) accountLargeImg.src = activeAvatar;

    if (settingsProfileName && name) settingsProfileName.textContent = name;
    if (settingsProfileRole && role) settingsProfileRole.textContent = role;
    if (greetingTitle && name) {
        if (!greetingTitle.classList.contains("page-title")) {
            greetingTitle.textContent = `Hi ${name},`;
        }
    }
}

function triggerAvatarUpload() {
    const input = document.getElementById("avatar-file-input");
    if (input) {
        input.click();
    }
}

// ==========================================================================
// Interactive Avatar Cropper & Position Adjuster Engine
// ==========================================================================
let cropperState = {
    img: null,
    scale: 1,
    minScale: 1,
    maxScale: 3.5,
    x: 0,
    y: 0,
    rotation: 0, // 0, 90, 180, 270
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    initialX: 0,
    initialY: 0,
    cropRadius: 110 // 220px circular aperture (in 280x280 canvas)
};

function renderCropCanvas() {
    const canvas = document.getElementById("avatar-crop-canvas");
    if (!canvas || !cropperState.img) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    // Reset transform & clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const cx = width / 2;
    const cy = height / 2;

    ctx.translate(cx + cropperState.x, cy + cropperState.y);
    ctx.rotate((cropperState.rotation * Math.PI) / 180);
    ctx.scale(cropperState.scale, cropperState.scale);

    const imgW = cropperState.img.width;
    const imgH = cropperState.img.height;
    ctx.drawImage(cropperState.img, -imgW / 2, -imgH / 2, imgW, imgH);

    ctx.restore();
}

function clampCropperBounds() {
    if (!cropperState.img) return;
    const isSideways = cropperState.rotation === 90 || cropperState.rotation === 270;
    const currentW = (isSideways ? cropperState.img.height : cropperState.img.width) * cropperState.scale;
    const currentH = (isSideways ? cropperState.img.width : cropperState.img.height) * cropperState.scale;

    const maxAllowedX = Math.max(0, (currentW - cropperState.cropRadius * 2) / 2);
    const maxAllowedY = Math.max(0, (currentH - cropperState.cropRadius * 2) / 2);

    cropperState.x = Math.max(-maxAllowedX, Math.min(maxAllowedX, cropperState.x));
    cropperState.y = Math.max(-maxAllowedY, Math.min(maxAllowedY, cropperState.y));
}

function openAvatarCropper(file) {
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
        showToast("Image size must be less than 15MB", "warning");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const image = new Image();
        image.onload = () => {
            cropperState.img = image;
            cropperState.rotation = 0;
            cropperState.x = 0;
            cropperState.y = 0;

            const cropDiameter = cropperState.cropRadius * 2;
            const minScaleX = cropDiameter / image.width;
            const minScaleY = cropDiameter / image.height;
            cropperState.minScale = Math.max(minScaleX, minScaleY);
            cropperState.maxScale = Math.max(cropperState.minScale * 3.5, 3.0);
            cropperState.scale = cropperState.minScale;

            const slider = document.getElementById("crop-zoom-slider");
            if (slider) {
                slider.min = cropperState.minScale;
                slider.max = cropperState.maxScale;
                slider.step = ((cropperState.maxScale - cropperState.minScale) / 100).toFixed(4);
                slider.value = cropperState.scale;
            }

            renderCropCanvas();

            const dialog = document.getElementById("avatar-cropper-modal");
            if (dialog && typeof dialog.showModal === "function") {
                dialog.showModal();
            }
        };
        image.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function closeAvatarCropper() {
    const dialog = document.getElementById("avatar-cropper-modal");
    if (dialog && dialog.open) {
        dialog.close();
    }
}

async function saveCroppedAvatar() {
    if (!cropperState.img) return;

    // High resolution 512x512 canvas output
    const outputCanvas = document.createElement("canvas");
    const outSize = 512;
    outputCanvas.width = outSize;
    outputCanvas.height = outSize;
    const ctx = outputCanvas.getContext("2d");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const cx = outSize / 2;
    const cy = outSize / 2;
    const scaleRatio = outSize / (cropperState.cropRadius * 2);

    ctx.translate(cx + cropperState.x * scaleRatio, cy + cropperState.y * scaleRatio);
    ctx.rotate((cropperState.rotation * Math.PI) / 180);
    ctx.scale(cropperState.scale * scaleRatio, cropperState.scale * scaleRatio);

    const imgW = cropperState.img.width;
    const imgH = cropperState.img.height;
    ctx.drawImage(cropperState.img, -imgW / 2, -imgH / 2, imgW, imgH);

    const croppedBase64 = outputCanvas.toDataURL("image/png", 0.95);
    closeAvatarCropper();

    // Optimistic preview immediately
    updateAllAvatars(croppedBase64, currentProfile.name, currentProfile.role);

    try {
        const res = await fetch("/api/user/avatar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: croppedBase64 })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            currentProfile = data.profile;
            updateAllAvatars(data.avatarUrl, currentProfile.name, currentProfile.role);
            showToast("Profile photo updated successfully!", "check_circle");
            const accountCard = document.querySelector(".account-profile-card");
            if (accountCard) {
                const removeBtn = document.getElementById("btn-remove-photo-account");
                if (!removeBtn) {
                    const actions = accountCard.querySelector(".account-profile-actions");
                    if (actions) {
                        actions.insertAdjacentHTML("beforeend", `
                            <button type="button" class="btn-remove-avatar" id="btn-remove-photo-account" title="Reset to default avatar">
                                <span class="material-symbols-outlined">delete</span>
                                <span>Remove</span>
                            </button>
                        `);
                        const newRemoveBtn = document.getElementById("btn-remove-photo-account");
                        if (newRemoveBtn) newRemoveBtn.addEventListener("click", removeAvatar);
                    }
                }
            }
        } else {
            throw new Error(data.error || "Upload failed");
        }
    } catch (err) {
        console.error("[Avatar] Upload error:", err);
        showToast("Failed to save avatar to server", "error");
        updateAllAvatars(currentProfile.avatarUrl, currentProfile.name, currentProfile.role);
    }
}

async function removeAvatar() {
    try {
        const res = await fetch("/api/user/avatar", { method: "DELETE" });
        const data = await res.json();
        if (res.ok && data.success) {
            currentProfile = data.profile;
            updateAllAvatars(null, currentProfile.name, currentProfile.role);
            showToast("Profile photo reset to default.", "delete");
            const removeBtn = document.getElementById("btn-remove-photo-account");
            if (removeBtn) removeBtn.remove();
        }
    } catch (err) {
        console.error("[Avatar] Delete error:", err);
        showToast("Failed to reset avatar", "error");
    }
}

async function fetchUserProfile() {
    try {
        const res = await fetch("/api/user/profile");
        if (res.ok) {
            currentProfile = await res.json();
            updateAllAvatars(currentProfile.avatarUrl, currentProfile.name, currentProfile.role);
        }
    } catch (err) {
        console.warn("[User Profile] Could not fetch profile:", err);
    }
}

function initAvatarUploadEvents() {
    const input = document.getElementById("avatar-file-input");
    const sidebarAvatar = document.getElementById("sidebar-avatar-wrapper");
    const settingsAvatar = document.getElementById("settings-profile-avatar");

    if (sidebarAvatar) {
        sidebarAvatar.addEventListener("click", triggerAvatarUpload);
        sidebarAvatar.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                triggerAvatarUpload();
            }
        });
    }

    if (settingsAvatar) {
        settingsAvatar.addEventListener("click", triggerAvatarUpload);
        settingsAvatar.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                triggerAvatarUpload();
            }
        });
    }

    if (input) {
        input.addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) {
                openAvatarCropper(file);
            }
            input.value = "";
        });
    }

    // Cropper Canvas Interactive Gestures (Drag Pan & Wheel Zoom)
    const canvasWrap = document.getElementById("cropper-canvas-wrapper");
    if (canvasWrap) {
        // Mouse Drag
        canvasWrap.addEventListener("mousedown", (e) => {
            cropperState.isDragging = true;
            cropperState.dragStartX = e.clientX;
            cropperState.dragStartY = e.clientY;
            cropperState.initialX = cropperState.x;
            cropperState.initialY = cropperState.y;
        });

        window.addEventListener("mousemove", (e) => {
            if (!cropperState.isDragging) return;
            const dx = e.clientX - cropperState.dragStartX;
            const dy = e.clientY - cropperState.dragStartY;
            cropperState.x = cropperState.initialX + dx;
            cropperState.y = cropperState.initialY + dy;
            clampCropperBounds();
            renderCropCanvas();
        });

        window.addEventListener("mouseup", () => {
            cropperState.isDragging = false;
        });

        // Touch Drag
        canvasWrap.addEventListener("touchstart", (e) => {
            if (e.touches.length === 1) {
                cropperState.isDragging = true;
                cropperState.dragStartX = e.touches[0].clientX;
                cropperState.dragStartY = e.touches[0].clientY;
                cropperState.initialX = cropperState.x;
                cropperState.initialY = cropperState.y;
            }
        }, { passive: true });

        canvasWrap.addEventListener("touchmove", (e) => {
            if (!cropperState.isDragging || e.touches.length !== 1) return;
            const dx = e.touches[0].clientX - cropperState.dragStartX;
            const dy = e.touches[0].clientY - cropperState.dragStartY;
            cropperState.x = cropperState.initialX + dx;
            cropperState.y = cropperState.initialY + dy;
            clampCropperBounds();
            renderCropCanvas();
        }, { passive: true });

        canvasWrap.addEventListener("touchend", () => {
            cropperState.isDragging = false;
        });

        // Mouse Wheel Zoom
        canvasWrap.addEventListener("wheel", (e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.08 : -0.08;
            const newScale = Math.max(cropperState.minScale, Math.min(cropperState.maxScale, cropperState.scale + delta));
            cropperState.scale = newScale;
            const slider = document.getElementById("crop-zoom-slider");
            if (slider) slider.value = newScale;
            clampCropperBounds();
            renderCropCanvas();
        }, { passive: false });
    }

    // Zoom Slider & Step Buttons
    const slider = document.getElementById("crop-zoom-slider");
    if (slider) {
        slider.addEventListener("input", (e) => {
            cropperState.scale = parseFloat(e.target.value);
            clampCropperBounds();
            renderCropCanvas();
        });
    }

    const zoomInBtn = document.getElementById("crop-zoom-in");
    if (zoomInBtn) {
        zoomInBtn.addEventListener("click", () => {
            const step = (cropperState.maxScale - cropperState.minScale) / 10;
            cropperState.scale = Math.min(cropperState.maxScale, cropperState.scale + step);
            if (slider) slider.value = cropperState.scale;
            clampCropperBounds();
            renderCropCanvas();
        });
    }

    const zoomOutBtn = document.getElementById("crop-zoom-out");
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener("click", () => {
            const step = (cropperState.maxScale - cropperState.minScale) / 10;
            cropperState.scale = Math.max(cropperState.minScale, cropperState.scale - step);
            if (slider) slider.value = cropperState.scale;
            clampCropperBounds();
            renderCropCanvas();
        });
    }

    // Rotate 90° Clockwise Button
    const rotateBtn = document.getElementById("crop-rotate-btn");
    if (rotateBtn) {
        rotateBtn.addEventListener("click", () => {
            cropperState.rotation = (cropperState.rotation + 90) % 360;
            // Recalculate minScale for rotated aspect ratio
            if (cropperState.img) {
                const isSideways = cropperState.rotation === 90 || cropperState.rotation === 270;
                const activeW = isSideways ? cropperState.img.height : cropperState.img.width;
                const activeH = isSideways ? cropperState.img.width : cropperState.img.height;
                const cropDiameter = cropperState.cropRadius * 2;
                cropperState.minScale = Math.max(cropDiameter / activeW, cropDiameter / activeH);
                cropperState.maxScale = Math.max(cropperState.minScale * 3.5, 3.0);
                if (cropperState.scale < cropperState.minScale) {
                    cropperState.scale = cropperState.minScale;
                }
                if (slider) {
                    slider.min = cropperState.minScale;
                    slider.max = cropperState.maxScale;
                    slider.value = cropperState.scale;
                }
            }
            clampCropperBounds();
            renderCropCanvas();
        });
    }

    // Reset Position & Zoom
    const resetBtn = document.getElementById("crop-reset-btn");
    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            cropperState.x = 0;
            cropperState.y = 0;
            cropperState.rotation = 0;
            if (cropperState.img) {
                const cropDiameter = cropperState.cropRadius * 2;
                cropperState.minScale = Math.max(cropDiameter / cropperState.img.width, cropDiameter / cropperState.img.height);
                cropperState.maxScale = Math.max(cropperState.minScale * 3.5, 3.0);
                cropperState.scale = cropperState.minScale;
                if (slider) {
                    slider.min = cropperState.minScale;
                    slider.max = cropperState.maxScale;
                    slider.value = cropperState.scale;
                }
            }
            renderCropCanvas();
        });
    }

    // Close & Save Actions
    const closeBtn = document.getElementById("cropper-close-btn");
    if (closeBtn) closeBtn.addEventListener("click", closeAvatarCropper);

    const cancelBtn = document.getElementById("cropper-cancel-btn");
    if (cancelBtn) cancelBtn.addEventListener("click", closeAvatarCropper);

    const saveBtn = document.getElementById("cropper-save-btn");
    if (saveBtn) saveBtn.addEventListener("click", saveCroppedAvatar);
}

// ==========================================================================
// Connection Status & Live MQTT Diagnostics Controller
// ==========================================================================
function updateConnectionPill(connected, host, error) {
    const pill = document.getElementById("status-pill");
    if (!pill) return;
    const label = pill.querySelector(".status-label");
    const sidebarStatus = document.getElementById("sidebar-brand-status");
    const sidebarStatusText = document.getElementById("sidebar-brand-status-text");

    if (connected) {
        pill.classList.remove("is-offline");
        if (label) label.textContent = "Broker Online";
        pill.title = `MQTT Broker Online (${host || 'HiveMQ Cloud'}) • Click for full diagnostics`;
        if (sidebarStatus) sidebarStatus.classList.remove("is-offline");
        if (sidebarStatusText) sidebarStatusText.textContent = "Online";
    } else {
        pill.classList.add("is-offline");
        if (label) label.textContent = "Broker Offline";
        pill.title = error ? `MQTT Error: ${error} • Click for full diagnostics` : "MQTT Offline • Click for full diagnostics";
        if (sidebarStatus) sidebarStatus.classList.add("is-offline");
        if (sidebarStatusText) sidebarStatusText.textContent = "Offline";
    }
}

let isFetchingDiagnostics = false;
async function fetchAndRenderDiagnostics(isAutoRefresh = false) {
    if (isFetchingDiagnostics) return;
    const dialog = document.getElementById("network-diagnostics-modal");
    if (!dialog) return;

    try {
        isFetchingDiagnostics = true;
        const res = await fetch("/api/mqtt/diagnostics");
        if (!res.ok) throw new Error("Failed to fetch diagnostics");
        const data = await res.json();

        // Update Pill state synchronously
        updateConnectionPill(data.connected, data.broker.host, data.connectionError);

        // Populate Modal Fields
        const avatar = document.getElementById("diag-status-avatar");
        const statusBadge = document.getElementById("diag-broker-status-badge");
        const endpointSubtext = document.getElementById("diag-broker-endpoint");
        
        if (avatar) avatar.classList.toggle("is-offline", !data.connected);
        if (statusBadge) {
            statusBadge.className = `diag-status-pill ${data.connected ? 'is-online' : 'is-offline'}`;
            statusBadge.innerHTML = `<span class="diag-dot"></span> ${data.connected ? 'Connected' : 'Disconnected'}`;
        }
        if (endpointSubtext) {
            endpointSubtext.textContent = data.broker.host ? `${data.broker.protocol}://${data.broker.host}:${data.broker.port}` : "No broker configured";
        }

        // Meta cards
        const protoEl = document.getElementById("diag-val-protocol");
        const clientEl = document.getElementById("diag-val-client-id");
        const baseEl = document.getElementById("diag-val-base-topic");
        const devCountEl = document.getElementById("diag-val-devices-count");

        if (protoEl) protoEl.textContent = `${data.broker.protocol}://${data.broker.port}`;
        if (clientEl) clientEl.textContent = data.broker.clientId;
        if (baseEl) baseEl.textContent = data.broker.baseTopic;
        if (devCountEl) devCountEl.textContent = `${data.stats.activeDevices} / ${data.stats.totalDevices}`;

        // Subscriptions List
        const topicsList = document.getElementById("diag-topics-list");
        if (topicsList) {
            topicsList.innerHTML = `
                <div class="diag-topic-item">
                    <div class="diag-topic-left">
                        <span class="diag-badge-sub">SUB</span>
                        <code class="diag-topic-code">${data.broker.baseTopic}/devices/+/state</code>
                    </div>
                    <span class="diag-topic-desc">Hardware feedback & physical buttons</span>
                </div>
                <div class="diag-topic-item">
                    <div class="diag-topic-left">
                        <span class="diag-badge-sub">SUB</span>
                        <code class="diag-topic-code">${data.broker.baseTopic}/system/#</code>
                    </div>
                    <span class="diag-topic-desc">Telemetry & heartbeat stream</span>
                </div>
                <div class="diag-topic-item">
                    <div class="diag-topic-left">
                        <span class="diag-badge-pub">PUB</span>
                        <code class="diag-topic-code">${data.broker.baseTopic}/devices/{id}/set</code>
                    </div>
                    <span class="diag-topic-desc">Dashboard control commands</span>
                </div>
            `;
        }

        // Room-level ESP32 Nodes Container
        const nodesContainer = document.getElementById("diag-nodes-container");
        if (nodesContainer && data.nodes) {
            nodesContainer.innerHTML = data.nodes.map(node => {
                const isOnline = node.status === "online";
                const badgeLabel = isOnline
                    ? `Online ${node.rssi ? '• ' + node.rssi + 'dBm' : (node.ip ? '• ' + node.ip : '')}`
                    : 'Offline • Not Detected';

                return `
                    <div class="diag-node-card">
                        <div class="diag-node-header">
                            <div class="diag-node-title-group">
                                <div class="diag-node-room-icon-wrap">
                                    <span class="material-symbols-outlined diag-node-room-icon">${node.roomIcon || 'meeting_room'}</span>
                                </div>
                                <span class="diag-node-room-name">${node.roomName}</span>
                                <span class="diag-node-esp-chip">${node.espNodeId}</span>
                            </div>
                            <span class="diag-node-status-badge ${isOnline ? 'is-online' : 'is-offline'}">
                                <span class="diag-dot"></span> ${badgeLabel}
                            </span>
                        </div>
                        <div class="diag-subdevices-grid">
                            ${node.devices.length > 0 ? node.devices.map(d => `
                                <div class="diag-subdevice-pill">
                                    <div class="diag-subdevice-left">
                                        <span class="material-symbols-outlined">${d.type === 'light' ? 'lightbulb' : (d.type === 'fan' ? 'mode_fan' : (d.type === 'ac' ? 'ac_unit' : (d.type === 'tv' ? 'tv' : 'power')))}</span>
                                        <span class="diag-subdevice-name" title="${d.name}">${d.name}</span>
                                    </div>
                                    <span class="diag-subdevice-state ${d.on ? 'is-on' : ''}">${d.on ? 'ON · ' + d.powerWatts + 'W' : 'OFF'}</span>
                                </div>
                            `).join('') : '<div style="font-size: 0.775rem; color: #94a3b8; font-style: italic;">No devices assigned to this room</div>'}
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (!isAutoRefresh && !dialog.open) {
            dialog.showModal();
        }
    } catch (err) {
        console.error("[Diagnostics] Fetch error:", err);
    } finally {
        isFetchingDiagnostics = false;
    }
}

// ==========================================================================
// SSE: Real-time Device Sync (physical button → dashboard tile)
// ==========================================================================
function initSSE() {
    if (window._sseSource) {
        window._sseSource.close();
    }
    const source = new EventSource("/api/events");
    window._sseSource = source;

    source.addEventListener("connected", () => {
        console.log("[SSE] Real-time event stream connected.");
        fetchAndRenderDiagnostics(true);
    });

    // Hardware node birth / LWT / heartbeat event
    source.addEventListener("node_status", () => {
        const diagModal = document.getElementById("network-diagnostics-modal");
        if (diagModal && diagModal.open) {
            fetchAndRenderDiagnostics(true);
        }
    });

    // Hardware button press or server action → update device tiles live with smooth animations
    source.addEventListener("device_update", (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.device) {
                if (window.Dashboard && window.Dashboard.devices) {
                    const idx = window.Dashboard.devices.findIndex(d => d.id === data.device.id);
                    if (idx !== -1) window.Dashboard.devices[idx] = data.device;
                }
                updateDeviceTileInDOM(data.device);
                if (window.Dashboard && typeof window.Dashboard.updateActiveCount === "function") {
                    window.Dashboard.updateActiveCount();
                }
            } else if (Array.isArray(data.devices)) {
                if (window.Dashboard && typeof window.Dashboard.syncDevicesAnimated === "function") {
                    window.Dashboard.syncDevicesAnimated(data.devices);
                }
            }
            const diagModal = document.getElementById("network-diagnostics-modal");
            if (diagModal && diagModal.open) {
                fetchAndRenderDiagnostics(true);
            }
        } catch (err) {
            console.error("[SSE] device_update parse error:", err);
        }
    });

    // MQTT broker status change → update the status dot in Settings & Header Pill
    source.addEventListener("mqtt_status", (e) => {
        try {
            const data = JSON.parse(e.data);
            const dot  = document.querySelector(".status-hud-dot");
            const text = document.getElementById("mqtt-status-text");
            if (dot)  dot.style.background  = data.connected ? "#10b981" : "#ef4444";
            if (text) text.textContent = data.connected
                ? `Connected to ${data.host}`
                : (data.error ? `Error: ${data.error}` : "Disconnected");

            updateConnectionPill(data.connected, data.host, data.error);
            const diagModal = document.getElementById("network-diagnostics-modal");
            if (diagModal && diagModal.open) {
                fetchAndRenderDiagnostics(true);
            }
        } catch (err) {}
    });

    // User profile avatar / name update from another tab or client
    source.addEventListener("profile_update", (e) => {
        try {
            const profile = JSON.parse(e.data);
            currentProfile = profile;
            updateAllAvatars(profile.avatarUrl, profile.name, profile.role);
            if (window.Dashboard && window.Dashboard.currentView === "settings" && window.Dashboard.currentSettingsTab === "account") {
                window.Dashboard.renderSettingsAccount();
            }
        } catch (err) {
            console.error("[SSE] profile_update parse error:", err);
        }
    });

    // Multi-user home members directory update
    source.addEventListener("members_update", (e) => {
        try {
            if (window.Dashboard && window.Dashboard.currentView === "settings" && window.Dashboard.currentSettingsTab === "account") {
                window.Dashboard.renderSettingsAccount();
            }
        } catch (err) {}
    });

    // Hardware Node Auto-Discovery events
    source.addEventListener("node_discovered", (e) => {
        try {
            const data = JSON.parse(e.data);
            if (window.Dashboard && window.Dashboard.currentView === "settings" && window.Dashboard.currentSettingsTab === "pairing") {
                if (window.Dashboard.renderSettingsPairing) window.Dashboard.renderSettingsPairing();
            }
        } catch (err) {}
    });

    source.addEventListener("node_paired", (e) => {
        try {
            if (window.Dashboard && window.Dashboard.currentView === "settings" && window.Dashboard.currentSettingsTab === "pairing") {
                if (window.Dashboard.renderSettingsPairing) window.Dashboard.renderSettingsPairing();
            }
        } catch (err) {}
    });

    source.addEventListener("node_unpaired", (e) => {
        try {
            if (window.Dashboard && window.Dashboard.currentView === "settings" && window.Dashboard.currentSettingsTab === "pairing") {
                if (window.Dashboard.renderSettingsPairing) window.Dashboard.renderSettingsPairing();
            }
        } catch (err) {}
    });

    source.addEventListener("rooms_update", () => {
        try {
            if (window.Dashboard && window.Dashboard.fetchRooms) {
                window.Dashboard.fetchRooms();
            }
        } catch (err) {}
    });

    // Real-Time ESP32 Serial / MQTT Console Log streaming
    source.addEventListener("node_log", (e) => {
        try {
            const logEntry = JSON.parse(e.data);
            if (window.Dashboard && typeof window.Dashboard.handleIncomingNodeLog === "function") {
                window.Dashboard.handleIncomingNodeLog(logEntry);
            }
        } catch (err) {}
    });

    // Real-Time Hardware Telemetry Stream (Heap, RSSI, Uptime)
    source.addEventListener("node_telemetry", (e) => {
        try {
            const data = JSON.parse(e.data);
            if (window.Dashboard && typeof window.Dashboard.handleIncomingTelemetry === "function") {
                window.Dashboard.handleIncomingTelemetry(data);
            }
        } catch (err) {}
    });

    // Real-Time Activity Log Events
    source.addEventListener("activity_log", (e) => {
        try {
            const data = JSON.parse(e.data);
            if (window.Dashboard && typeof window.Dashboard.handleIncomingActivityLog === "function") {
                window.Dashboard.handleIncomingActivityLog(data);
            }
        } catch (err) {}
    });

    source.onerror = () => {
        console.warn("[SSE] Stream lost. EventSource will auto-reconnect.");
    };
}

// Surgically update a single device tile in the DOM (no full re-render)
function updateDeviceTileInDOM(device) {
    const tile = document.querySelector(`.device-tile[data-id="${device.id}"]`);
    if (!tile) return;

    // Active / inactive glow
    tile.classList.toggle("is-active", !!device.on);

    // Toggle checkbox
    const checkbox = tile.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = !!device.on;

    // Power watt badge
    const boltBadge = tile.querySelector(".info-badge");
    if (boltBadge) {
        boltBadge.innerHTML = `<span class="material-symbols-outlined badge-icon">bolt</span>${device.on ? device.powerWatts : 0}W`;
    }

    // Status text (tile-status)
    const statusEl = tile.querySelector(".tile-status");
    if (statusEl) {
        if (!device.on) {
            statusEl.textContent = "Off";
        } else if (device.type === "ac" && device.temperature) {
            statusEl.textContent = `Climate \u2022 ${device.temperature}\u00b0C`;
        } else if (device.type === "light" && device.dimmable && device.brightness) {
            statusEl.textContent = `Dim: ${device.brightness}%`;
        } else if (device.type === "fan" && device.speed) {
            statusEl.textContent = `Speed ${device.speed}`;
        } else {
            statusEl.textContent = "Active";
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    console.log("Dashboard Frontend initialized with dynamic templating & SPA navigation.");

    // State
    let rooms = [];
    let devices = [];
    let currentRoom = "bed";
    let currentManageRoomFilter = "all";
    let currentView = localStorage.getItem("sh_active_view") || "dashboard";

    // Icon lookup by device type
    const getDeviceIcon = (type) => {
        switch (type.toLowerCase()) {
            case "fan": return "mode_fan";
            case "socket": return "power";
            case "tv": return "tv";
            case "ac": return "ac_unit";
            case "light":
            default: return "lightbulb";
        }
    };

    // Surgically synchronize and animate multiple device tiles without recreating DOM
    const syncDevicesAnimated = (updatedList) => {
        if (!Array.isArray(updatedList)) return;
        updatedList.forEach((dev) => {
            const idx = devices.findIndex((d) => d.id === dev.id);
            if (idx !== -1) {
                Object.assign(devices[idx], dev);
            } else {
                devices.push(dev);
            }
            updateDeviceTileInDOM(dev);
        });
        updateActiveCount();
        if (currentView === "settings") {
            renderManageDevices();
        }
    };

    // Expose Shared Dashboard State & Functions to Modular Subsystems
    window.Dashboard = {
        get currentView() { return currentView; },
        get currentSettingsTab() { return currentSettingsTab; },
        get settingsData() { return settingsData; },
        set settingsData(v) { settingsData = v; },
        get devices() { return devices; },
        get rooms() { return rooms; },
        get currentRoom() { return currentRoom; },
        showToast: (msg, icon, danger) => showToast(msg, icon, danger),
        showConfirmDialog: (opts) => showConfirmDialog(opts),
        showAlertDialog: (opts) => showAlertDialog(opts),
        fetchDevices: () => fetchDevices(),
        fetchRooms: () => fetchRooms(),
        renderDevices: () => renderDevices(),
        syncDevicesAnimated: (devs) => syncDevicesAnimated(devs),
        updateDeviceTileInDOM: (device) => updateDeviceTileInDOM(device),
        updateActiveCount: () => updateActiveCount(),
        renderSettingsAccount: () => renderSettingsAccount(),
        renderSettingsPairing: () => renderSettingsPairing(),
        handleIncomingNodeLog: (log) => handleIncomingNodeLog(log),
        handleIncomingTelemetry: (data) => handleIncomingTelemetry(data),
        handleIncomingActivityLog: (log) => handleIncomingActivityLog(log)
    };

    // 1. Sidebar Navigation & View Switching (Zero Page Reload)
    const navItems = document.querySelectorAll(".navigation-options > ul > li");

    // Smart Confirmation Dialogue Box
    const showConfirmDialog = ({
        title = "Are you sure?",
        message = "This action cannot be undone.",
        confirmText = "Delete",
        cancelText = "Cancel",
        isDestructive = true,
        icon = "delete"
    } = {}) => {
        return new Promise((resolve) => {
            const dialog = document.getElementById("apple-confirm-dialog");
            if (!dialog) {
                resolve(window.confirm(message || title));
                return;
            }

            const titleEl = document.getElementById("confirm-dialog-title");
            const descEl = document.getElementById("confirm-dialog-desc");
            const iconEl = document.getElementById("confirm-dialog-icon");
            const iconWrap = document.getElementById("confirm-dialog-icon-wrap");
            const cancelBtn = document.getElementById("btn-confirm-cancel");
            const proceedBtn = document.getElementById("btn-confirm-proceed");

            if (titleEl) titleEl.textContent = title;
            if (descEl) descEl.textContent = message;
            if (iconEl) iconEl.textContent = icon;

            if (proceedBtn) {
                proceedBtn.textContent = confirmText;
                proceedBtn.className = isDestructive ? "btn-confirm-proceed" : "btn-confirm-proceed is-neutral";
            }

            if (iconWrap) {
                iconWrap.className = "confirm-dialog-icon-wrap";
                if (!isDestructive && icon === "info") iconWrap.classList.add("is-info");
                else if (icon === "warning") iconWrap.classList.add("is-warning");
            }

            if (cancelBtn) {
                cancelBtn.style.display = cancelText ? "block" : "none";
                cancelBtn.textContent = cancelText || "Cancel";
            }

            const cleanup = (result) => {
                dialog.close();
                cancelBtn.onclick = null;
                proceedBtn.onclick = null;
                dialog.onclose = null;
                resolve(result);
            };

            cancelBtn.onclick = () => cleanup(false);
            proceedBtn.onclick = () => cleanup(true);
            dialog.onclose = () => cleanup(false);

            dialog.showModal();
        });
    };

    const showAlertDialog = ({
        title = "Attention",
        message = "",
        confirmText = "OK",
        icon = "info"
    } = {}) => {
        return showConfirmDialog({
            title,
            message,
            confirmText,
            cancelText: null,
            isDestructive: false,
            icon
        });
    };

    // Expose globally for modular scripts
    window.showConfirmDialog = showConfirmDialog;
    window.showAlertDialog = showAlertDialog;

    // Toast Notification System (Apple & Stripe Floating Frosted Glass Card)
    const showToast = (message, icon = "check", isDanger = false) => {
        const container = document.getElementById("toast-container");
        if (!container) return;

        let iconName = icon;
        let type = isDanger ? "danger" : "success";

        if (icon === "success" || icon === "check" || icon === "check_circle" || icon === "verified") {
            iconName = "check";
            type = "success";
        } else if (icon === "delete" || icon === "error" || isDanger) {
            iconName = icon === "delete" ? "delete" : "error";
            type = "danger";
        } else if (icon === "warning") {
            iconName = "warning";
            type = "warning";
        } else if (icon === "bolt" || icon === "palette" || icon === "info" || icon === "cell_tower" || icon === "content_copy" || icon === "toggle_on") {
            iconName = icon;
            type = "info";
        }

        const toast = document.createElement("div");
        toast.className = `toast-pill toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon-wrap">
                <span class="material-symbols-outlined toast-icon">${iconName}</span>
            </div>
            <span class="toast-message">${message}</span>
            <button type="button" class="toast-close-btn" aria-label="Dismiss notification">
                <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
            </button>
        `;

        const closeBtn = toast.querySelector(".toast-close-btn");
        let timer = null;
        const dismiss = () => {
            if (timer) clearTimeout(timer);
            toast.classList.add("toast-fadeout");
            setTimeout(() => toast.remove(), 250);
        };

        if (closeBtn) closeBtn.addEventListener("click", dismiss);
        container.appendChild(toast);
        timer = setTimeout(dismiss, 3500);
    };

    // Relative Time Helper
    const formatRelativeTime = (isoString) => {
        try {
            const date = new Date(isoString);
            const now = new Date();
            const diffSeconds = Math.floor((now - date) / 1000);
            if (diffSeconds < 60) return "Just now";
            const diffMinutes = Math.floor(diffSeconds / 60);
            if (diffMinutes < 60) return `${diffMinutes}m ago`;
            const diffHours = Math.floor(diffMinutes / 60);
            if (diffHours < 24) return `${diffHours}h ago`;
            return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        } catch {
            return "Recently";
        }
    };

    const switchView = (viewName) => {
        currentView = viewName;
        try { localStorage.setItem("sh_active_view", viewName); } catch (e) {}

        // Simple class toggle — CSS transition handles the smooth background/color change
        // Same mechanism as the settings sub-nav items
        navItems.forEach((item) => {
            item.classList.toggle("active", item.dataset.view === viewName);
        });

        // Hide all view panels, activate targeted one
        const panels = document.querySelectorAll(".view-panel");
        panels.forEach((p) => p.classList.remove("active"));

        const greetingTitle = document.getElementById("header-greeting-title");
        const greetingSubtitle = document.getElementById("header-greeting-subtitle");
        const roomPillWrapper = document.getElementById("header-room-pill-wrapper");

        if (viewName === "dashboard") {
            const dashPanel = document.getElementById("view-dashboard");
            if (dashPanel) dashPanel.classList.add("active");
            if (greetingTitle) {
                greetingTitle.classList.remove("page-title");
                greetingTitle.textContent = `Hi ${currentProfile.name || "Abhi"},`;
            }
            if (greetingSubtitle) {
                const activeCount = devices.filter((d) => d.on).length;
                greetingSubtitle.innerHTML = `Welcome home &bull; <span id="active-devices-count">${activeCount}</span> devices active`;
            }
            if (roomPillWrapper) roomPillWrapper.style.display = "";
            renderDevices();
            renderDashboardQuickActions();
        } else if (viewName === "settings") {
            const settingsPanel = document.getElementById("view-settings");
            if (settingsPanel) settingsPanel.classList.add("active");
            if (greetingTitle) {
                greetingTitle.classList.add("page-title");
                greetingTitle.textContent = "System & Hardware Settings";
            }
            if (greetingSubtitle) greetingSubtitle.textContent = "Configure hardware, network bridges, themes, and system security";
            if (roomPillWrapper) roomPillWrapper.style.display = "none";
            fetchSettings().then(() => renderActiveSettingsView());
        } else if (viewName === "automations") {
            const autoPanel = document.getElementById("view-automations");
            if (autoPanel) autoPanel.classList.add("active");
            if (greetingTitle) {
                greetingTitle.classList.add("page-title");
                greetingTitle.textContent = "Automations & Scenes";
            }
            if (greetingSubtitle) greetingSubtitle.textContent = "Configure smart schedules, routines, and scenes";
            if (roomPillWrapper) roomPillWrapper.style.display = "none";
            fetchAndRenderAutomations();
        } else if (viewName === "energy") {
            const energyPanel = document.getElementById("view-energy");
            if (energyPanel) energyPanel.classList.add("active");
            if (greetingTitle) {
                greetingTitle.classList.add("page-title");
                greetingTitle.textContent = "Energy Analytics";
            }
            if (greetingSubtitle) greetingSubtitle.textContent = "Monitor active wattage, peak loads, and consumption trends";
            if (roomPillWrapper) roomPillWrapper.style.display = "none";
            fetchAndRenderEnergy();
        } else if (viewName === "logs") {
            const logsPanel = document.getElementById("view-logs");
            if (logsPanel) logsPanel.classList.add("active");
            if (greetingTitle) {
                greetingTitle.classList.add("page-title");
                greetingTitle.textContent = "Activity & Intelligence";
            }
            if (greetingSubtitle) greetingSubtitle.textContent = "Live wireless console, device timeline, telemetry, and security audit";
            if (roomPillWrapper) roomPillWrapper.style.display = "none";
            renderActiveIntelTab();
        }
    };

    navItems.forEach((item) => {
        item.addEventListener("click", () => {
            const view = item.dataset.view || "dashboard";
            switchView(view);
        });
    });



    // 2. Logout Button Click Interaction
    const btnLogout = document.querySelector(".logout .Btn");
    if (btnLogout) {
        btnLogout.addEventListener("click", () => {
            btnLogout.style.transform = "translate(2px, 2px) scale(0.96)";
            setTimeout(() => {
                btnLogout.style.transform = "";
            }, 200);
        });
    }

    // 3. Dynamic Date & Day Display
    const dateDayElem = document.getElementById("date-day");
    const dateFullElem = document.getElementById("date-full");
    if (dateDayElem && dateFullElem) {
        const now = new Date();
        dateDayElem.textContent = now.toLocaleDateString("en-US", { weekday: "long" });
        dateFullElem.textContent = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    // --------------------------------------------------------------------------
    // 3b. Open-Meteo Real-Time Weather & Air Quality (AQI) Controller
    // --------------------------------------------------------------------------
    let currentWeatherPayload = null;

    const fetchAndRenderWeather = async (forceRefresh = false) => {
        try {
            const url = forceRefresh ? "/api/weather?refresh=true" : "/api/weather";
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`);
            const data = await res.json();
            if (!data || !data.success) return;

            currentWeatherPayload = data;

            // 1. Current Temperature & Condition
            const tempElem = document.getElementById("weather-temp");
            const feelsElem = document.getElementById("weather-feels-like");
            const iconElem = document.getElementById("weather-main-icon");
            const conditionElem = document.getElementById("weather-condition");
            const locationElem = document.getElementById("weather-location");

            if (tempElem) tempElem.textContent = `${data.current.temp}°C`;
            if (feelsElem) feelsElem.textContent = `Feels like ${data.current.feelsLike}°`;
            if (iconElem) iconElem.textContent = data.current.icon || "partly_cloudy_day";
            if (conditionElem) {
                conditionElem.innerHTML = `${data.current.condition} &bull; H: ${data.daily.high}° L: ${data.daily.low}°`;
            }
            if (locationElem) {
                locationElem.innerHTML = `<span class="material-symbols-outlined" style="font-size:0.95rem; vertical-align:text-bottom; margin-right:3px;">location_on</span>${data.location.city}`;
                locationElem.title = `Latitude: ${data.location.latitude.toFixed(2)}°, Longitude: ${data.location.longitude.toFixed(2)}° (Click to change in Settings)`;
                locationElem.style.cursor = "pointer";
                locationElem.onclick = () => {
                    const settingsNavBtn = document.querySelector('li[data-view="settings"]');
                    if (settingsNavBtn) settingsNavBtn.click();
                    setTimeout(() => {
                        const weatherTab = document.querySelector('button.settings-nav-item[data-tab="weather"]');
                        if (weatherTab) weatherTab.click();
                    }, 100);
                };
            }

            // 2. Atmospheric Micro-Metrics
            const humElem = document.getElementById("weather-humidity");
            const windElem = document.getElementById("weather-wind");
            const uvElem = document.getElementById("weather-uv");

            if (humElem) humElem.textContent = `${data.current.humidity}%`;
            if (windElem) windElem.textContent = `${data.current.windSpeed} km/h`;
            if (uvElem) {
                let uvLabel = "Low";
                if (data.current.uvIndex >= 8) uvLabel = "Very High";
                else if (data.current.uvIndex >= 6) uvLabel = "High";
                else if (data.current.uvIndex >= 3) uvLabel = "Mod";
                uvElem.textContent = `${data.current.uvIndex} ${uvLabel}`;
            }

            // 3. Hourly Forecast Strip
            const hourlyStrip = document.getElementById("weather-hourly-strip");
            if (hourlyStrip && Array.isArray(data.hourly) && data.hourly.length > 0) {
                hourlyStrip.innerHTML = data.hourly.map((h) => `
                    <div class="hourly-item ${h.isNow ? 'is-now' : ''}" title="${h.condition}">
                        <span class="hourly-time">${h.time}</span>
                        <span class="material-symbols-outlined hourly-icon">${h.icon}</span>
                        <span class="hourly-temp">${h.temp}°</span>
                    </div>
                `).join("");
            }

            // 4. Live Air Quality (AQI) in Environment Card
            const aqiValElem = document.getElementById("room-aqi");
            const aqiStatusElem = document.getElementById("room-aqi-status");
            if (aqiValElem && data.airQuality) {
                aqiValElem.textContent = data.airQuality.aqi;
                aqiValElem.parentElement.title = `US AQI: ${data.airQuality.aqi} • PM2.5: ${data.airQuality.pm25 ? data.airQuality.pm25 + ' µg/m³' : 'N/A'}`;
            }
            if (aqiStatusElem && data.airQuality) {
                aqiStatusElem.textContent = data.airQuality.label;
                aqiStatusElem.className = `metric-status ${data.airQuality.statusClass || 'status-good'}`;
                aqiStatusElem.title = data.airQuality.advice || "";
            }

            // 5. Contextual Weather Alert Class
            const weatherBlock = document.querySelector(".weather-block");
            if (weatherBlock) {
                const isRainy = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(data.current.weatherCode);
                if (isRainy) {
                    weatherBlock.classList.add("has-rain-alert");
                } else {
                    weatherBlock.classList.remove("has-rain-alert");
                }
            }

        } catch (err) {
            console.warn("[Weather] Could not update live dashboard weather:", err);
        }
    };

    // Auto-fetch weather on load and every 15 minutes
    fetchAndRenderWeather();
    setInterval(() => fetchAndRenderWeather(), 15 * 60 * 1000);

    // 4. Update Header Active Device Counter
    const updateActiveCount = () => {
        const activeCountElem = document.getElementById("active-devices-count");
        if (activeCountElem) {
            const activeCount = devices.filter((d) => d.on).length;
            activeCountElem.textContent = activeCount;
        }
    };

    // 5. Clean Device Card Template with Secondary Info & Dynamic Controls
    const createDeviceTileHTML = (device) => {
        const isOn = !!device.on;
        const icon = getDeviceIcon(device.type);
        let statusText = "Off";
        if (isOn) {
            if (device.type === "fan") {
                statusText = `On • Speed ${device.speed || 3}`;
            } else if (device.type === "ac") {
                statusText = `On • ${device.temperature || 22}°C ${(device.mode || 'cool').toUpperCase()}`;
            } else if (device.type === "light" && device.dimmable) {
                statusText = `On • ${device.brightness || 80}%`;
            } else {
                statusText = `On • ${device.powerWatts}W`;
            }
        }
        const badgeLabel = device.type === "ac"
            ? `Climate • ${device.temperature || 22}°C`
            : (device.type === "light" && device.dimmable)
                ? `Dim: ${device.brightness || 80}%`
                : device.surgeProtected
                    ? "Surge Protect"
                    : device.type === "fan"
                        ? `Speed ${device.speed || 3}`
                        : "Smart Control";

        return `
            <div class="device-tile ${isOn ? 'is-active' : ''}" data-id="${device.id}" data-type="${device.type}" data-room="${device.room}" title="Click to toggle • Press & hold for detailed controls">
                <div class="tile-top">
                    <span class="material-symbols-outlined tile-icon">${icon}</span>
                    <label class="switch" aria-label="Toggle ${device.name}">
                        <input type="checkbox" ${isOn ? 'checked' : ''} data-id="${device.id}">
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="tile-bottom">
                    <span class="tile-name">${device.name}</span>
                    <span class="tile-status">${statusText}</span>
                    <div class="tile-secondary-info">
                        <span class="info-badge">
                            <span class="material-symbols-outlined badge-icon">bolt</span>${isOn ? device.powerWatts : 0}W
                        </span>
                        <span class="info-badge">${badgeLabel}</span>
                    </div>
                </div>
            </div>
        `;
    };

    // 6. Render Device Tiles Container (Daily Dashboard)
    const renderDevices = () => {
        const grid = document.getElementById("tiles-device-grid");
        if (!grid) return;

        const filtered = devices.filter((d) => {
            if (currentRoom === "all") return true;
            return d.room.toLowerCase() === currentRoom.toLowerCase();
        });

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="empty-room-state">
                    <div class="empty-state-icon-wrap">
                        <span class="material-symbols-outlined">devices</span>
                    </div>
                    <p class="empty-room-text">No devices in ${currentRoom} room yet.</p>
                    <button type="button" class="btn-manage-secondary" id="empty-state-manage-btn">
                        <span class="material-symbols-outlined">settings</span>
                        <span>Manage in Settings</span>
                    </button>
                </div>
            `;
            const emptyBtn = document.getElementById("empty-state-manage-btn");
            if (emptyBtn) {
                emptyBtn.addEventListener("click", () => switchView("settings"));
            }
            return;
        }

        grid.innerHTML = filtered.map(createDeviceTileHTML).join("");

        // Attach Unified Tile Click (Toggle) & Press-and-Hold (Detail Modal)
        grid.querySelectorAll(".device-tile").forEach((tile) => {
            let pressTimer = null;
            let startX = 0;
            let startY = 0;
            let isLongPress = false;
            let hasMoved = false;

            const cancelPress = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
                tile.classList.remove("tile-pressing");
            };

            const onPointerDown = (e) => {
                // Only primary button (left mouse / single touch) initiates press-and-hold
                if (e.button && e.button !== 0) return;

                isLongPress = false;
                hasMoved = false;
                startX = e.clientX;
                startY = e.clientY;

                tile.classList.add("tile-pressing");

                pressTimer = setTimeout(() => {
                    isLongPress = true;
                    tile.classList.remove("tile-pressing");
                    tile.classList.add("tile-long-pressed");
                    setTimeout(() => tile.classList.remove("tile-long-pressed"), 300);

                    // Optional haptic tap if supported (smartphones/tablets)
                    if (navigator.vibrate) {
                        try { navigator.vibrate(40); } catch (_) {}
                    }

                    const id = tile.dataset.id;
                    const dev = devices.find((d) => d.id === id);
                    if (dev) openDeviceDetailModal(dev);
                }, 500); // 500ms: responsive, deliberate long-press threshold
            };

            const onPointerMove = (e) => {
                if (!pressTimer) return;
                const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
                // If user moves/scrolls by more than 8px, cancel press
                if (dist > 8) {
                    hasMoved = true;
                    cancelPress();
                }
            };

            const onPointerUp = () => {
                cancelPress();
            };

            const onClick = async (e) => {
                // If triggered by long-press or dragged during page scroll, suppress toggle
                if (isLongPress || hasMoved) {
                    isLongPress = false;
                    hasMoved = false;
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                // Quick Tap / Click ➔ Toggle device power immediately
                const id = tile.dataset.id;
                await toggleDevice(id, true);
            };

            // Pointer events for unified cross-device support (mouse, trackpad, touchscreen)
            tile.addEventListener("pointerdown", onPointerDown);
            tile.addEventListener("pointermove", onPointerMove);
            tile.addEventListener("pointerup", onPointerUp);
            tile.addEventListener("pointercancel", cancelPress);
            tile.addEventListener("pointerleave", cancelPress);
            tile.addEventListener("click", onClick);

            // Desktop Right-Click bonus: Open Detail Controls instantly
            tile.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                cancelPress();
                const id = tile.dataset.id;
                const dev = devices.find((d) => d.id === id);
                if (dev) openDeviceDetailModal(dev);
            });
        });
    };

    // Device Detail & Secondary Controls Modal Logic
    const openDeviceDetailModal = (device) => {
        const modal = document.getElementById("device-detail-modal");
        if (!modal) return;

        const iconEl = document.getElementById("detail-device-icon");
        const avatarEl = document.getElementById("detail-device-avatar");
        const nameEl = document.getElementById("detail-device-name");
        const roomEl = document.getElementById("detail-device-room");
        const subtextEl = document.getElementById("detail-status-subtext");
        const masterToggle = document.getElementById("detail-master-toggle");
        const controlsBody = document.getElementById("detail-controls-body");
        const powerDisplay = document.getElementById("detail-power-display");
        const stateDisplay = document.getElementById("detail-state-display");

        if (nameEl) nameEl.textContent = device.name;
        if (roomEl) roomEl.textContent = device.room;
        if (iconEl) iconEl.textContent = getDeviceIcon(device.type);
        if (avatarEl) avatarEl.classList.toggle("is-active", !!device.on);
        if (masterToggle) masterToggle.checked = !!device.on;
        if (powerDisplay) powerDisplay.textContent = `${device.on ? device.powerWatts : 0}W`;
        if (stateDisplay) stateDisplay.textContent = device.on ? "Active" : "Off";
        if (subtextEl) subtextEl.textContent = device.on ? `Online • ${device.powerWatts}W draw` : "Powered Off • 0W draw";

        // Render controls based on device type
        if (controlsBody) {
            if (device.type === "light") {
                if (device.dimmable === false) {
                    controlsBody.innerHTML = `
                        <div style="padding: 0.5rem 0; font-size: 0.825rem; color: #4b5563; line-height: 1.5;">
                            <p>Non-dimmable light. Real-time draw: <strong>${device.powerWatts}W</strong>.</p>
                            <p style="margin-top: 0.35rem; color: #86868b; font-size: 0.75rem;">Use master power switch above to toggle this unit.</p>
                        </div>
                    `;
                } else {
                    const brightness = device.brightness || 80;
                    controlsBody.innerHTML = `
                    <div class="detail-slider-group">
                        <div class="detail-slider-header">
                            <span>Light Intensity</span>
                            <span class="detail-slider-val-badge" id="detail-light-val">${brightness}%</span>
                        </div>
                        <input type="range" class="detail-range-slider" id="detail-light-slider" min="5" max="100" step="5" value="${brightness}">
                        <div class="detail-preset-chips">
                            <button type="button" class="detail-chip-btn ${brightness === 25 ? 'is-active' : ''}" data-val="25">25% Night</button>
                            <button type="button" class="detail-chip-btn ${brightness === 50 ? 'is-active' : ''}" data-val="50">50% Cozy</button>
                            <button type="button" class="detail-chip-btn ${brightness === 75 ? 'is-active' : ''}" data-val="75">75% Reading</button>
                            <button type="button" class="detail-chip-btn ${brightness === 100 ? 'is-active' : ''}" data-val="100">100% Bright</button>
                        </div>
                    </div>
                `;

                const slider = controlsBody.querySelector("#detail-light-slider");
                const valBadge = controlsBody.querySelector("#detail-light-val");
                const chips = controlsBody.querySelectorAll(".detail-chip-btn");

                const applyBrightness = async (val) => {
                    valBadge.textContent = `${val}%`;
                    chips.forEach((c) => c.classList.toggle("is-active", Number(c.dataset.val) === val));
                    try {
                        const res = await fetch(`/api/devices/${device.id}/settings`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ on: true, brightness: val })
                        });
                        const data = await res.json();
                        if (data.success) {
                            Object.assign(device, data.device);
                            renderDevices();
                            updateActiveCount();
                            if (powerDisplay) powerDisplay.textContent = `${device.powerWatts}W`;
                            if (subtextEl) subtextEl.textContent = `Online • ${device.powerWatts}W draw`;
                            if (avatarEl) avatarEl.classList.add("is-active");
                            if (masterToggle) masterToggle.checked = true;
                        }
                    } catch (err) {
                        console.error("Failed to update brightness:", err);
                    }
                };

                slider.addEventListener("input", () => {
                    valBadge.textContent = `${slider.value}%`;
                });
                slider.addEventListener("change", () => {
                    applyBrightness(Number(slider.value));
                });
                chips.forEach((chip) => {
                    chip.addEventListener("click", () => {
                        const v = Number(chip.dataset.val);
                        slider.value = v;
                        applyBrightness(v);
                    });
                });
                }
            } else if (device.type === "fan") {
                const speed = device.speed || 3;
                controlsBody.innerHTML = `
                    <div class="detail-fan-group">
                        <div class="detail-slider-header">
                            <span>Fan Speed Level</span>
                            <span class="detail-slider-val-badge" id="detail-fan-val">Speed ${speed}</span>
                        </div>
                        <div class="detail-fan-buttons">
                            <button type="button" class="detail-fan-btn ${speed === 1 ? 'is-active' : ''}" data-speed="1">
                                <span class="material-symbols-outlined">eco</span>
                                <span>1 Eco (25W)</span>
                            </button>
                            <button type="button" class="detail-fan-btn ${speed === 2 ? 'is-active' : ''}" data-speed="2">
                                <span class="material-symbols-outlined">air</span>
                                <span>2 Med (40W)</span>
                            </button>
                            <button type="button" class="detail-fan-btn ${speed === 3 ? 'is-active' : ''}" data-speed="3">
                                <span class="material-symbols-outlined">mode_fan</span>
                                <span>3 Turbo (55W)</span>
                            </button>
                        </div>
                    </div>
                `;

                const fanBtns = controlsBody.querySelectorAll(".detail-fan-btn");
                const valBadge = controlsBody.querySelector("#detail-fan-val");

                fanBtns.forEach((btn) => {
                    btn.addEventListener("click", async () => {
                        const s = Number(btn.dataset.speed);
                        fanBtns.forEach((b) => b.classList.remove("is-active"));
                        btn.classList.add("is-active");
                        if (valBadge) valBadge.textContent = `Speed ${s}`;

                        try {
                            const res = await fetch(`/api/devices/${device.id}/settings`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ on: true, speed: s })
                            });
                            const data = await res.json();
                            if (data.success) {
                                Object.assign(device, data.device);
                                renderDevices();
                                updateActiveCount();
                                if (powerDisplay) powerDisplay.textContent = `${device.powerWatts}W`;
                                if (subtextEl) subtextEl.textContent = `Online • ${device.powerWatts}W draw`;
                                if (avatarEl) avatarEl.classList.add("is-active");
                                if (masterToggle) masterToggle.checked = true;
                            }
                        } catch (err) {
                            console.error("Failed to update fan speed:", err);
                        }
                    });
                });
            } else if (device.type === "ac") {
                let temp = device.temperature || 22;
                let mode = device.mode || "cool";

                controlsBody.innerHTML = `
                    <div class="detail-slider-group">
                        <div class="detail-slider-header">
                            <span>Target Climate</span>
                            <span class="detail-slider-val-badge" id="detail-ac-temp-badge">${temp}°C</span>
                        </div>
                        <div class="detail-climate-dial">
                            <button type="button" class="climate-stepper-btn" id="btn-temp-minus">−</button>
                            <div class="climate-temp-readout" id="climate-temp-readout">${temp}°C</div>
                            <button type="button" class="climate-stepper-btn" id="btn-temp-plus">+</button>
                        </div>
                        <input type="range" class="detail-range-slider" id="detail-ac-slider" min="16" max="30" step="1" value="${temp}">
                        <div class="detail-climate-modes">
                            <button type="button" class="climate-mode-btn ${mode === 'cool' ? 'is-active' : ''}" data-mode="cool">❄️ Cool</button>
                            <button type="button" class="climate-mode-btn ${mode === 'eco' ? 'is-active' : ''}" data-mode="eco">🍃 Eco</button>
                            <button type="button" class="climate-mode-btn ${mode === 'heat' ? 'is-active' : ''}" data-mode="heat">☀️ Heat</button>
                        </div>
                    </div>
                `;

                const readout = controlsBody.querySelector("#climate-temp-readout");
                const badge = controlsBody.querySelector("#detail-ac-temp-badge");
                const slider = controlsBody.querySelector("#detail-ac-slider");
                const btnMinus = controlsBody.querySelector("#btn-temp-minus");
                const btnPlus = controlsBody.querySelector("#btn-temp-plus");
                const modeBtns = controlsBody.querySelectorAll(".climate-mode-btn");

                const applyAcSettings = async (newTemp, newMode) => {
                    temp = newTemp !== undefined ? newTemp : temp;
                    mode = newMode !== undefined ? newMode : mode;

                    if (readout) readout.textContent = `${temp}°C`;
                    if (badge) badge.textContent = `${temp}°C`;
                    if (slider) slider.value = temp;

                    try {
                        const res = await fetch(`/api/devices/${device.id}/settings`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ on: true, temperature: temp, mode: mode })
                        });
                        const data = await res.json();
                        if (data.success) {
                            Object.assign(device, data.device);
                            renderDevices();
                            updateActiveCount();
                            if (powerDisplay) powerDisplay.textContent = `${device.powerWatts}W`;
                            if (subtextEl) subtextEl.textContent = `Online • ${device.powerWatts}W draw`;
                            if (avatarEl) avatarEl.classList.add("is-active");
                            if (masterToggle) masterToggle.checked = true;
                        }
                    } catch (err) {
                        console.error("Failed to update AC settings:", err);
                    }
                };

                btnMinus.addEventListener("click", () => {
                    if (temp > 16) applyAcSettings(temp - 1, mode);
                });
                btnPlus.addEventListener("click", () => {
                    if (temp < 30) applyAcSettings(temp + 1, mode);
                });
                slider.addEventListener("input", () => {
                    if (readout) readout.textContent = `${slider.value}°C`;
                    if (badge) badge.textContent = `${slider.value}°C`;
                });
                slider.addEventListener("change", () => {
                    applyAcSettings(Number(slider.value), mode);
                });
                modeBtns.forEach((mBtn) => {
                    mBtn.addEventListener("click", () => {
                        modeBtns.forEach((b) => b.classList.remove("is-active"));
                        mBtn.classList.add("is-active");
                        applyAcSettings(temp, mBtn.dataset.mode);
                    });
                });
            } else {
                controlsBody.innerHTML = `
                    <div style="padding: 0.5rem 0; font-size: 0.825rem; color: #4b5563; line-height: 1.5;">
                        <p>Smart load monitoring active. Real-time draw: <strong>${device.powerWatts}W</strong>.</p>
                        <p style="margin-top: 0.35rem; color: #86868b; font-size: 0.75rem;">Use master power switch above to toggle this unit.</p>
                    </div>
                `;
            }
        }

        // Master toggle change listener
        masterToggle.onchange = async () => {
            const isChecked = masterToggle.checked;
            try {
                const res = await fetch(`/api/devices/${device.id}/settings`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ on: isChecked })
                });
                const data = await res.json();
                if (data.success) {
                    Object.assign(device, data.device);
                    renderDevices();
                    updateActiveCount();
                    if (avatarEl) avatarEl.classList.toggle("is-active", !!device.on);
                    if (powerDisplay) powerDisplay.textContent = `${device.on ? device.powerWatts : 0}W`;
                    if (stateDisplay) stateDisplay.textContent = device.on ? "Active" : "Off";
                    if (subtextEl) subtextEl.textContent = device.on ? `Online • ${device.powerWatts}W draw` : "Powered Off • 0W draw";
                }
            } catch (err) {
                console.error("Failed to toggle device:", err);
            }
        };

        modal.showModal();
    };

    const closeDeviceDetailModal = () => {
        const modal = document.getElementById("device-detail-modal");
        if (modal && modal.open) modal.close();
    };

    // Wire Device Detail Modal dismiss controls
    const detailCloseBtn = document.getElementById("detail-modal-close-btn");
    const detailDoneBtn = document.getElementById("detail-modal-done-btn");
    const detailModal = document.getElementById("device-detail-modal");
    if (detailCloseBtn) detailCloseBtn.addEventListener("click", closeDeviceDetailModal);
    if (detailDoneBtn) detailDoneBtn.addEventListener("click", closeDeviceDetailModal);
    if (detailModal) {
        detailModal.addEventListener("click", (e) => {
            const rect = detailModal.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                closeDeviceDetailModal();
            }
        });
    }

    // ==========================================================================
    // 7. Settings View: Apple macOS–Style Master-Detail Subsystem
    // ==========================================================================
    let currentSettingsTab = localStorage.getItem("sh_active_settings_tab") || "devices";
    let settingsData = null;

    const fetchSettings = async () => {
        try {
            const res = await fetch("/api/settings");
            if (res.ok) {
                settingsData = await res.json();
                if (settingsData.theme && settingsData.theme.preset) {
                    applyTheme(settingsData.theme.preset);
                }
                if (settingsData.account && settingsData.account.name) {
                    const profileElem = document.getElementById("settings-profile-name");
                    if (profileElem) profileElem.textContent = settingsData.account.name;
                }
                renderDashboardQuickActions();
            }
        } catch (e) {
            console.warn("Using fallback local settings:", e);
        }
    };

    const applyTheme = (preset) => {
        document.body.classList.remove("theme-apple", "theme-warm", "theme-midnight");
        if (preset === "apple") document.body.classList.add("theme-apple");
        else if (preset === "warm") document.body.classList.add("theme-warm");
        else if (preset === "midnight") document.body.classList.add("theme-midnight");
    };

    const renderActiveSettingsView = () => {
        const detailPane = document.getElementById("settings-detail-pane");
        if (!detailPane) return;
        try { localStorage.setItem("sh_active_settings_tab", currentSettingsTab); } catch (e) {}

        // Update active class on sub-nav buttons
        document.querySelectorAll("#settings-nav-list .settings-nav-item").forEach((btn) => {
            const isActive = btn.dataset.tab === currentSettingsTab;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        // Trigger fluid slide-in animation on the detail pane
        detailPane.classList.remove("settings-detail-pane-animate");
        // Force reflow so the animation re-triggers
        void detailPane.offsetWidth;
        detailPane.classList.add("settings-detail-pane-animate");

        switch (currentSettingsTab) {
            case "devices":
                renderSettingsDevices();
                break;
            case "rooms":
                renderSettingsRooms();
                break;
            case "quickactions":
                renderSettingsQuickActions();
                break;
            case "mqtt":
                renderSettingsMqtt();
                break;
            case "pairing":
                renderSettingsPairing();
                break;
            case "database":
                renderSettingsDatabase();
                break;
            case "weather":
                renderSettingsWeather();
                break;
            case "theme":
                renderSettingsTheme();
                break;
            case "account":
                renderSettingsAccount();
                break;
            default:
                renderSettingsDevices();
        }

        // Clean up animation class after it completes
        detailPane.addEventListener("animationend", () => {
            detailPane.classList.remove("settings-detail-pane-animate");
        }, { once: true });
    };


    // Sub-Section 1: Devices
    const renderSettingsDevices = () => {
        const detailPane = document.getElementById("settings-detail-pane");
        if (!detailPane) return;

        const filtered = devices.filter((d) => {
            if (currentManageRoomFilter === "all") return true;
            return d.room.toLowerCase() === currentManageRoomFilter.toLowerCase();
        });

        detailPane.innerHTML = `
            <div class="settings-section-header">
                <div class="settings-header-left">
                    <div class="settings-pane-icon">
                        <span class="material-symbols-outlined">devices</span>
                    </div>
                    <div class="settings-header-titles">
                        <h2>Devices & Hardware</h2>
                        <p id="manage-devices-count">${devices.length} device${devices.length === 1 ? '' : 's'} configured across ${rooms.length} room${rooms.length === 1 ? '' : 's'}</p>
                    </div>
                </div>
                <div class="settings-header-actions" style="display: flex; gap: 0.5rem; align-items: center;">
                    <button type="button" class="btn-manage-secondary" id="open-add-device-btn" title="Add custom virtual accessory">
                        <span class="material-symbols-outlined">add</span>
                        <span>Add Custom</span>
                    </button>
                    <button type="button" class="btn-manage-primary" id="open-pair-wizard-btn" title="Pair and configure ESP32 relays">
                        <span class="material-symbols-outlined">sensors</span>
                        <span>Pair ESP32</span>
                    </button>
                </div>
            </div>

            <div class="manage-filter-bar" id="manage-device-filter-bar">
                <button type="button" class="manage-filter-pill ${currentManageRoomFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
                ${rooms.map(r => `
                    <button type="button" class="manage-filter-pill ${currentManageRoomFilter === r.id ? 'active' : ''}" data-filter="${r.id}">${r.name}</button>
                `).join('')}
            </div>

            <div class="devices-list-stack" id="manage-devices-list">
                ${filtered.length === 0 ? `
                    <div class="empty-room-state" style="padding: 2.5rem 1rem;">
                        <div class="empty-state-icon-wrap">
                            <span class="material-symbols-outlined">devices</span>
                        </div>
                        <p class="empty-room-text">No devices matching this room.</p>
                    </div>
                ` : filtered.map(d => `
                    <div class="manage-device-card" data-id="${d.id}">
                        <div class="manage-device-left">
                            <div class="device-avatar-badge">
                                <span class="material-symbols-outlined">${getDeviceIcon(d.type)}</span>
                            </div>
                            <div class="manage-device-titles">
                                <span class="manage-device-name">${d.name}</span>
                                <div class="manage-device-badges">
                                    <span class="badge-room-tag">${d.room}</span>
                                    <span class="badge-type-tag">${d.type}</span>
                                    ${d.gpio !== undefined ? `
                                        <span class="badge-gpio-tag" title="Physical ESP32 GPIO Relay Pin">
                                            <span class="material-symbols-outlined">memory</span>GPIO ${d.gpio}
                                        </span>
                                    ` : `
                                        <span class="badge-gpio-tag" style="background: rgba(107, 114, 128, 0.08); color: #6b7280; border-color: rgba(107, 114, 128, 0.2);" title="Software-only Virtual Device">
                                            <span class="material-symbols-outlined">cloud</span>Virtual
                                        </span>
                                    `}
                                </div>
                            </div>
                        </div>
                        <div class="manage-device-right">
                            <span class="manage-status-pill ${d.on ? 'is-active' : ''}">
                                <span class="dot"></span>
                                <span>${d.on ? `${d.powerWatts || 40}W` : 'Off'}</span>
                            </span>
                            <button type="button" class="btn-edit-device" data-id="${d.id}" aria-label="Edit ${d.name}" title="Edit device details">
                                <span class="material-symbols-outlined">edit</span>
                                <span>Edit</span>
                            </button>
                            <button type="button" class="btn-remove-device" data-id="${d.id}" aria-label="Remove ${d.name}">
                                <span class="material-symbols-outlined">delete</span>
                                <span>Remove</span>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        const addBtn = document.getElementById("open-add-device-btn");
        if (addBtn) addBtn.addEventListener("click", () => openDeviceModal());

        const pairBtn = document.getElementById("open-pair-wizard-btn");
        if (pairBtn) {
            pairBtn.addEventListener("click", () => {
                currentSettingsTab = "pairing";
                renderActiveSettingsView();
            });
        }

        detailPane.querySelectorAll(".manage-filter-pill").forEach(btn => {
            btn.addEventListener("click", () => {
                currentManageRoomFilter = btn.dataset.filter;
                renderSettingsDevices();
            });
        });

        detailPane.querySelectorAll(".btn-edit-device").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                openDeviceModal(id);
            });
        });

        detailPane.querySelectorAll(".btn-remove-device").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const dev = devices.find(d => d.id === id);
                const confirmed = await showConfirmDialog({
                    title: `Remove "${dev ? dev.name : 'Device'}"?`,
                    message: "This accessory will be removed from your home setup and dashboard.",
                    confirmText: "Remove",
                    isDestructive: true,
                    icon: "delete"
                });
                if (confirmed) {
                    await deleteDevice(id);
                    renderSettingsDevices();
                }
            });
        });
    };

    // Sub-Section 2: Rooms
    const renderSettingsRooms = () => {
        const detailPane = document.getElementById("settings-detail-pane");
        if (!detailPane) return;

        detailPane.innerHTML = `
            <div class="settings-section-header">
                <div class="settings-header-left">
                    <div class="settings-pane-icon">
                        <span class="material-symbols-outlined">meeting_room</span>
                    </div>
                    <div class="settings-header-titles">
                        <h2>Rooms & Zones</h2>
                        <p>${rooms.length} configured home room${rooms.length === 1 ? '' : 's'}</p>
                    </div>
                </div>
                <button type="button" class="btn-manage-primary" id="open-add-room-btn">
                    <span class="material-symbols-outlined">add</span>
                    <span>Add Room</span>
                </button>
            </div>

            <div class="rooms-list-stack">
                ${rooms.map(room => {
                    const count = devices.filter(d => d.room.toLowerCase() === room.id.toLowerCase()).length;
                    return `
                        <div class="manage-room-card" data-id="${room.id}">
                            <div class="manage-room-info">
                                <div class="room-avatar-badge">
                                    <span class="material-symbols-outlined">${room.icon || 'meeting_room'}</span>
                                </div>
                                <div>
                                    <span class="room-name-text">${room.name}</span>
                                    <span class="room-device-pill">${count} device${count === 1 ? '' : 's'}</span>
                                </div>
                            </div>
                            <button type="button" class="room-del-btn" data-id="${room.id}" aria-label="Delete ${room.name} room" title="Delete room">
                                <span class="material-symbols-outlined">delete</span>
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        const addBtn = document.getElementById("open-add-room-btn");
        if (addBtn) addBtn.addEventListener("click", () => openRoomModal());

        detailPane.querySelectorAll(".room-del-btn").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                await deleteRoom(id);
                renderSettingsRooms();
            });
        });
    };

    // Sub-Section 3: Quick Actions Studio (Modular Delegator)
    const renderSettingsQuickActions = () => {
        if (window.QuickActions && typeof window.QuickActions.renderSettingsStudio === "function") {
            window.QuickActions.renderSettingsStudio();
        }
    };

    // Sub-Section 4: MQTT Broker
    const renderSettingsMqtt = () => {
        const detailPane = document.getElementById("settings-detail-pane");
        if (!detailPane) return;

        const mqtt = (settingsData && settingsData.mqtt) || {
            host: "",
            port: 8883,
            protocol: "mqtts",
            baseTopic: "smarthub",
            clientId: "home-dashboard",
            username: "",
            connected: false,
            lastPingMs: null
        };

        // Parse host & protocol
        let parsedProtocol = mqtt.protocol || "mqtts";
        let parsedHost = mqtt.host || "";
        if (!parsedHost && mqtt.broker) {
            const m = mqtt.broker.match(/^(mqtt[s]?|ws[s]?):\/\/(.+)/);
            if (m) { parsedProtocol = m[1]; parsedHost = m[2]; }
        }

        const isConnected = !!mqtt.connected;
        const statusColor = isConnected ? "#10b981" : "#ef4444";
        const statusLabel = isConnected
            ? `Connected to ${parsedHost || "broker"}`
            : (parsedHost ? `Disconnected from ${parsedHost}` : "No broker configured");
        const latencyLabel = mqtt.lastPingMs ? `Latency: ${mqtt.lastPingMs}ms` : (isConnected ? "Online" : "Offline");

        detailPane.innerHTML = `
            <div class="settings-section-header">
                <div class="settings-header-left">
                    <div class="settings-pane-icon">
                        <span class="material-symbols-outlined">cell_tower</span>
                    </div>
                    <div class="settings-header-titles">
                        <h2>MQTT Broker Bridge</h2>
                        <p>Hardware bus connectivity, message queuing, and pub/sub routing</p>
                    </div>
                </div>
            </div>

            <div class="status-hud-banner">
                <div class="status-hud-left">
                    <span class="status-hud-dot" style="background: ${statusColor};"></span>
                    <span class="status-hud-text" id="mqtt-status-text">${statusLabel}</span>
                </div>
                <span class="status-hud-meta" id="mqtt-ping-meta">${latencyLabel}</span>
            </div>

            <form class="settings-card-form" id="mqtt-config-form">
                <div class="form-field-grid">
                    <div class="settings-input-wrap">
                        <label>Protocol</label>
                        <select id="mqtt-protocol" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(0,0,0,0.1);background:#fff;font-size:14px;color:#1d1d1f;cursor:pointer;">
                            <option value="mqtts" ${parsedProtocol === "mqtts" ? "selected" : ""}>mqtts:// &nbsp; (TLS • HiveMQ Cloud, port 8883)</option>
                            <option value="mqtt"  ${parsedProtocol === "mqtt"  ? "selected" : ""}>mqtt:// &nbsp;&nbsp; (Plain • local broker, port 1883)</option>
                            <option value="wss"   ${parsedProtocol === "wss"   ? "selected" : ""}>wss:// &nbsp;&nbsp;&nbsp; (WebSocket TLS)</option>
                            <option value="ws"    ${parsedProtocol === "ws"    ? "selected" : ""}>ws:// &nbsp;&nbsp;&nbsp;&nbsp; (WebSocket plain)</option>
                        </select>
                    </div>
                    <div class="settings-input-wrap">
                        <label>Broker Port</label>
                        <input type="number" id="mqtt-broker-port" value="${mqtt.port || 8883}" required>
                    </div>
                    <div class="settings-input-wrap" style="grid-column: 1 / -1;">
                        <label>Broker Hostname</label>
                        <input type="text" id="mqtt-broker-host" value="${parsedHost}" placeholder="e.g. your-broker.s1.eu.hivemq.cloud" required>
                    </div>
                    <div class="settings-input-wrap">
                        <label>Base Topic Prefix</label>
                        <input type="text" id="mqtt-broker-topic" value="${mqtt.baseTopic || "smarthub"}" required>
                    </div>
                    <div class="settings-input-wrap">
                        <label>Client Identifier</label>
                        <input type="text" id="mqtt-broker-client" value="${mqtt.clientId || "home-dashboard"}" required>
                    </div>
                    <div class="settings-input-wrap">
                        <label>Auth Username</label>
                        <input type="text" id="mqtt-broker-user" value="${mqtt.username || ""}" autocomplete="off">
                    </div>
                    <div class="settings-input-wrap">
                        <label>Auth Password</label>
                        <input type="password" id="mqtt-broker-pass" value="" placeholder="Leave blank to keep saved password" autocomplete="new-password">
                    </div>
                </div>
                <div class="settings-form-actions" style="display: flex; gap: 0.75rem; align-items: center; justify-content: flex-end;">
                    <button type="button" class="btn-settings-ghost" id="btn-test-mqtt">Test Connection</button>
                    ${isConnected ? `<button type="button" class="btn-settings-ghost" id="btn-disconnect-mqtt" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.35);">Disconnect</button>` : ''}
                    <button type="submit" class="btn-manage-primary">Save &amp; Connect</button>
                </div>
            </form>

            <div style="margin-top:16px;padding:14px 16px;background:rgba(0,0,0,0.03);border-radius:12px;border:1px solid rgba(0,0,0,0.06);">
                <p style="margin:0;font-size:12px;color:#86868b;line-height:1.6;">
                    <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">info</span>
                    &nbsp;Credentials are automatically stored in <code>Backend/mqtt-config.json</code> on your server.
                </p>
            </div>
        `;

        // ── Disconnect Button Handler ─────────────────────────────────────────
        const disconnectBtn = document.getElementById("btn-disconnect-mqtt");
        if (disconnectBtn) {
            disconnectBtn.addEventListener("click", async () => {
                disconnectBtn.disabled = true;
                disconnectBtn.textContent = "Disconnecting...";
                try {
                    const res = await fetch("/api/settings/mqtt/disconnect", { method: "POST" });
                    const data = await res.json();
                    if (data.success) {
                        showToast("MQTT Broker disconnected", "power_off");
                        if (settingsData && settingsData.mqtt) {
                            settingsData.mqtt.connected = false;
                        }
                        updateConnectionPill(false, parsedHost, "Manual Disconnect");
                        renderSettingsMqtt();
                    }
                } catch (e) {
                    showToast("Failed to disconnect", "error", true);
                    disconnectBtn.disabled = false;
                    disconnectBtn.textContent = "Disconnect";
                }
            });
        }

        // ── Test Connection Button ──────────────────────────────────────────
        const testBtn = document.getElementById("btn-test-mqtt");
        if (testBtn) {
            testBtn.addEventListener("click", async () => {
                const protocol = document.getElementById("mqtt-protocol").value;
                const host     = document.getElementById("mqtt-broker-host").value.trim();
                const port     = parseInt(document.getElementById("mqtt-broker-port").value, 10);
                const username = document.getElementById("mqtt-broker-user").value.trim();
                const password = document.getElementById("mqtt-broker-pass").value;
                const clientId = document.getElementById("mqtt-broker-client").value.trim();

                if (!host) {
                    showToast("Enter a broker hostname first.", "error", true);
                    return;
                }

                testBtn.textContent = "Testing...";
                testBtn.disabled = true;
                showToast("Connecting to MQTT broker...", "cell_tower");

                try {
                    const res  = await fetch("/api/settings/mqtt/test", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ protocol, host, port, username,
                            ...(password ? { password } : {}) })
                    });
                    const data = await res.json();

                    const dot  = document.querySelector(".status-hud-dot");
                    const text = document.getElementById("mqtt-status-text");
                    const ping = document.getElementById("mqtt-ping-meta");

                    if (data.success) {
                        showToast(`Handshake OK \u2014 ${data.message} (${data.pingMs}ms)`, "check_circle");
                        if (dot)  dot.style.background = "#10b981";
                        if (text) text.textContent = `Test connected to ${host}`;
                        if (ping) ping.textContent   = `Latency: ${data.pingMs}ms`;
                    } else {
                        showToast(`Connection failed: ${data.error}`, "error", true);
                        if (dot)  dot.style.background = "#ef4444";
                        if (text) text.textContent = `Failed: ${data.error}`;
                    }
                } catch (e) {
                    showToast("Broker ping failed. Check your network.", "error", true);
                } finally {
                    testBtn.textContent = "Test Connection";
                    testBtn.disabled = false;
                }
            });
        }

        // ── Save & Connect Form Submit ──────────────────────────────────────
        const form = document.getElementById("mqtt-config-form");
        if (form) {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                const protocol = document.getElementById("mqtt-protocol").value;
                const host     = document.getElementById("mqtt-broker-host").value.trim();
                const port     = parseInt(document.getElementById("mqtt-broker-port").value, 10);
                const baseTopic = document.getElementById("mqtt-broker-topic").value.trim();
                const clientId = document.getElementById("mqtt-broker-client").value.trim();
                const username = document.getElementById("mqtt-broker-user").value.trim();
                const password = document.getElementById("mqtt-broker-pass").value;

                const payload = {
                    section: "mqtt",
                    data: {
                        broker: `${protocol}://${host}`,
                        host, protocol, port, baseTopic, clientId, username,
                        // Only send password if user typed something new
                        ...(password ? { password } : {})
                    }
                };

                const res = await fetch("/api/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    showToast("MQTT settings saved. Reconnecting to broker...", "check_circle");
                    const text = document.getElementById("mqtt-status-text");
                    if (text) text.textContent = `Connecting to ${host}...`;
                    await fetchSettings();
                    setTimeout(() => renderSettingsMqtt(), 600);
                }
            });
        }
    };

    // Sub-Section 5: Device Pairing & Hardware Auto-Discovery Engine
    const renderSettingsPairing = async () => {
        const detailPane = document.getElementById("settings-detail-pane");
        if (!detailPane) return;

        detailPane.innerHTML = `
            <div class="settings-section-header">
                <div class="settings-header-left">
                    <div class="settings-pane-icon">
                        <span class="material-symbols-outlined">sensors</span>
                    </div>
                    <div class="settings-header-titles">
                        <h2>Device Pairing & Auto-Discovery</h2>
                        <p>Zero-code setup, dynamic channel configuration, and ESP32 cloud adoption</p>
                    </div>
                </div>
            </div>

            <div class="pairing-hero-card">
                <div class="radar-circle-wrap">
                    <div class="radar-pulse-ring" id="radar-ring" style="display: none;"></div>
                    <span class="material-symbols-outlined radar-center-icon">radar</span>
                </div>
                <div>
                    <h3 class="pairing-title" id="pairing-status-title">Hardware Discovery Engine</h3>
                    <p class="pairing-desc" id="pairing-status-desc">Power on your ESP32 controller. Once connected to Wi-Fi via captive portal, it will broadcast its discovery beacon here automatically.</p>
                </div>
                <div class="pairing-actions-row">
                    <button type="button" class="btn-scan-devices" id="btn-start-scan">
                        <span class="material-symbols-outlined">refresh</span>
                        <span id="scan-btn-label">Scan for Beacons</span>
                    </button>
                </div>
            </div>

            <!-- Discovered Unpaired Hardware Section -->
            <div class="pairing-section-box" id="unpaired-nodes-section">
                <div class="pairing-section-header-row">
                    <h3 class="pairing-section-title">
                        <span class="material-symbols-outlined" style="color: #0071e3;">sensors</span>
                        Discovered Unpaired Controllers
                    </h3>
                    <span class="pairing-count-badge" id="unpaired-count-badge">0 Found</span>
                </div>
                <div class="node-card-grid" id="unpaired-nodes-list">
                    <div class="empty-nodes-notice">
                        <span class="material-symbols-outlined" style="font-size: 1.8rem; color: #8e8e93;">wifi_tethering_off</span>
                        <span>No new ESP32 controllers broadcasting right now. Power on your device and make sure it's connected to Wi-Fi.</span>
                    </div>
                </div>
            </div>

            <!-- Active Paired Room Controllers Section -->
            <div class="pairing-section-box" id="paired-nodes-section">
                <div class="pairing-section-header-row">
                    <h3 class="pairing-section-title">
                        <span class="material-symbols-outlined" style="color: #10b981;">hub</span>
                        Active Room Controllers
                    </h3>
                    <span class="pairing-count-badge" id="paired-count-badge">0 Configured</span>
                </div>
                <div class="node-card-grid" id="paired-nodes-list">
                    <!-- Populated dynamically -->
                </div>
            </div>
        `;

        // Load discovered & registered nodes from backend
        let nodesData = { nodes: [] };
        try {
            const res = await fetch("/api/nodes/discovered");
            if (res.ok) nodesData = await res.json();
        } catch (e) {
            console.warn("[Pairing] Failed to fetch discovered nodes:", e);
        }

        const nodes = nodesData.nodes || [];
        const unpaired = nodes.filter(n => n.status === "unpaired" || !n.pairedRoom);
        const paired = nodes.filter(n => n.status === "paired" || !!n.pairedRoom);

        // Update counts
        const unpairedBadge = document.getElementById("unpaired-count-badge");
        const pairedBadge = document.getElementById("paired-count-badge");
        if (unpairedBadge) unpairedBadge.textContent = `${unpaired.length} Found`;
        if (pairedBadge) pairedBadge.textContent = `${paired.length} Configured`;

        // Render Unpaired Nodes
        const unpairedList = document.getElementById("unpaired-nodes-list");
        if (unpairedList && unpaired.length > 0) {
            unpairedList.innerHTML = unpaired.map(node => `
                <div class="hardware-node-card is-unpaired" data-node-id="${node.nodeId}">
                    <div class="hardware-node-left">
                        <div class="node-avatar-chip">
                            <span class="material-symbols-outlined">developer_board</span>
                        </div>
                        <div class="node-titles-wrap">
                            <div class="node-main-name">
                                <span>${node.nodeId}</span>
                                <span class="node-status-badge unpaired">Ready to Pair</span>
                            </div>
                            <div class="node-meta-chips">
                                <span class="node-meta-chip"><span class="material-symbols-outlined" style="font-size:0.85rem;">wifi</span> ${node.ip || '192.168.1.x'}</span>
                                <span class="node-meta-chip"><span class="material-symbols-outlined" style="font-size:0.85rem;">fingerprint</span> ${node.mac || 'MAC'}</span>
                                <span class="node-meta-chip"><span class="material-symbols-outlined" style="font-size:0.85rem;">toggle_on</span> ${(node.relays || [25,33,32,27,26]).length} Relays</span>
                                <span class="node-meta-chip"><span class="material-symbols-outlined" style="font-size:0.85rem;">signal_cellular_alt</span> ${node.rssi || -50} dBm</span>
                            </div>
                        </div>
                    </div>
                    <div class="node-actions-right">
                        <button type="button" class="btn-node-action btn-node-identify" data-node-id="${node.nodeId}">
                            <span class="material-symbols-outlined" style="font-size:0.95rem;">lightbulb</span> Identify
                        </button>
                        <button type="button" class="btn-node-action btn-node-pair" data-node-id="${node.nodeId}">
                            <span class="material-symbols-outlined" style="font-size:0.95rem;">link</span> Pair to Room
                        </button>
                        <button type="button" class="btn-node-action btn-node-dismiss" data-node-id="${node.nodeId}" title="Dismiss node">
                            <span class="material-symbols-outlined" style="font-size:0.95rem;">close</span>
                        </button>
                    </div>
                </div>
            `).join('');

            // Attach identify & pair handlers
            unpairedList.querySelectorAll(".btn-node-identify").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const nid = btn.dataset.nodeId;
                    btn.disabled = true;
                    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:0.95rem;">notifications_active</span> Blinking...`;
                    await fetch("/api/nodes/identify", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ nodeId: nid })
                    });
                    showToast(`Flashing indicator LED on ${nid}`, "lightbulb");
                    setTimeout(() => {
                        btn.disabled = false;
                        btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:0.95rem;">lightbulb</span> Identify`;
                    }, 4000);
                });
            });

            unpairedList.querySelectorAll(".btn-node-pair").forEach(btn => {
                btn.addEventListener("click", () => {
                    const nid = btn.dataset.nodeId;
                    const nodeObj = nodes.find(n => n.nodeId === nid);
                    if (nodeObj) openPairingWizardModal(nodeObj);
                });
            });

            unpairedList.querySelectorAll(".btn-node-dismiss").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const nid = btn.dataset.nodeId;
                    const card = btn.closest(".hardware-node-card");
                    btn.disabled = true;
                    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:0.95rem;">hourglass_empty</span>`;
                    const r = await fetch(`/api/nodes/dismiss/${nid}`, { method: "DELETE" });
                    if (r.ok) {
                        card.style.transition = "opacity 0.25s, transform 0.25s";
                        card.style.opacity = "0";
                        card.style.transform = "translateX(16px)";
                        setTimeout(() => card.remove(), 260);
                        // Update count badge
                        const badge = document.getElementById("unpaired-count-badge");
                        if (badge) {
                            const cur = parseInt(badge.textContent) || 1;
                            badge.textContent = `${Math.max(0, cur - 1)} Found`;
                        }
                        showToast(`Node ${nid} dismissed`, "delete");
                    } else {
                        btn.disabled = false;
                        btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:0.95rem;">close</span>`;
                        showToast("Failed to dismiss node", "error");
                    }
                });
            });
        }

        // Render Paired Nodes
        const pairedList = document.getElementById("paired-nodes-list");
        if (pairedList) {
            if (paired.length === 0) {
                pairedList.innerHTML = `
                    <div class="empty-nodes-notice">
                        <span class="material-symbols-outlined" style="font-size: 1.8rem; color: #8e8e93;">hub</span>
                        <span>No room controllers are currently configured. Pair a discovered node above to assign it to a room.</span>
                    </div>
                `;
            } else {
                pairedList.innerHTML = paired.map(node => {
                    const roomObj = rooms.find(r => r.id === node.pairedRoom);
                    const roomName = roomObj ? roomObj.name : (node.pairedRoom || "Unassigned");
                    const isOnline = node.status !== "offline";
                    return `
                        <div class="hardware-node-card is-paired" data-node-id="${node.nodeId}">
                            <div class="hardware-node-left">
                                <div class="node-avatar-chip">
                                    <span class="material-symbols-outlined">${roomObj ? (roomObj.icon || 'meeting_room') : 'hub'}</span>
                                </div>
                                <div class="node-titles-wrap">
                                    <div class="node-main-name">
                                        <span>${roomName} Controller (${node.nodeId})</span>
                                        <span class="node-status-badge ${isOnline ? 'paired' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</span>
                                    </div>
                                    <div class="node-meta-chips">
                                        <span class="node-meta-chip"><span class="material-symbols-outlined" style="font-size:0.85rem;">meeting_room</span> Room: ${roomName}</span>
                                        <span class="node-meta-chip"><span class="material-symbols-outlined" style="font-size:0.85rem;">wifi</span> ${node.ip || '192.168.1.x'}</span>
                                        <span class="node-meta-chip"><span class="material-symbols-outlined" style="font-size:0.85rem;">fingerprint</span> ${node.mac || 'MAC'}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="node-actions-right">
                                <button type="button" class="btn-node-action btn-node-identify" data-node-id="${node.nodeId}">
                                    <span class="material-symbols-outlined" style="font-size:0.95rem;">lightbulb</span> Identify
                                </button>
                                <button type="button" class="btn-node-action btn-node-identify btn-reconfig" data-node-id="${node.nodeId}">
                                    <span class="material-symbols-outlined" style="font-size:0.95rem;">tune</span> Reconfigure
                                </button>
                                <button type="button" class="btn-node-action btn-node-unpair" data-node-id="${node.nodeId}">
                                    <span class="material-symbols-outlined" style="font-size:0.95rem;">link_off</span> Unpair
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

                // Attach paired node handlers
                pairedList.querySelectorAll(".btn-node-identify").forEach(btn => {
                    btn.addEventListener("click", async () => {
                        const nid = btn.dataset.nodeId;
                        btn.disabled = true;
                        btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:0.95rem;">notifications_active</span> Blinking...`;
                        await fetch("/api/nodes/identify", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ nodeId: nid })
                        });
                        showToast(`Flashing indicator LED on ${nid}`, "lightbulb");
                        setTimeout(() => {
                            btn.disabled = false;
                            btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:0.95rem;">lightbulb</span> Identify`;
                        }, 4000);
                    });
                });

                pairedList.querySelectorAll(".btn-reconfig").forEach(btn => {
                    btn.addEventListener("click", () => {
                        const nid = btn.dataset.nodeId;
                        const nodeObj = nodes.find(n => n.nodeId === nid);
                        if (nodeObj) openPairingWizardModal(nodeObj);
                    });
                });

                pairedList.querySelectorAll(".btn-node-unpair").forEach(btn => {
                    btn.addEventListener("click", async () => {
                        const nid = btn.dataset.nodeId;
                        const ok = await showConfirmDialog({
                            title: `Unpair Controller?`,
                            message: `Are you sure you want to unpair ${nid}? It will revert to the unpaired discovery pool.`,
                            confirmText: "Unpair Node",
                            isDestructive: true,
                            icon: "link_off"
                        });
                        if (!ok) return;

                        try {
                            const res = await fetch("/api/nodes/unpair", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ nodeId: nid, deleteDevices: false })
                            });
                            if (res.ok) {
                                showToast(`Node ${nid} unpaired successfully.`, "check_circle");
                                renderSettingsPairing();
                            }
                        } catch (err) {
                            showToast("Failed to unpair node", "error", true);
                        }
                    });
                });
            }
        }

        // Radar Scan Button Handler
        const scanBtn = document.getElementById("btn-start-scan");
        const radarRing = document.getElementById("radar-ring");
        const statusTitle = document.getElementById("pairing-status-title");
        const statusDesc = document.getElementById("pairing-status-desc");

        if (scanBtn) {
            scanBtn.addEventListener("click", () => {
                if (radarRing) radarRing.style.display = "block";
                scanBtn.disabled = true;
                if (statusTitle) statusTitle.textContent = "Scanning MQTT Subnet...";
                if (statusDesc) statusDesc.textContent = "Listening for live ESP32 beacon announcements...";

                setTimeout(async () => {
                    if (radarRing) radarRing.style.display = "none";
                    scanBtn.disabled = false;
                    if (statusTitle) statusTitle.textContent = "Discovery Engine Active";
                    if (statusDesc) statusDesc.textContent = "Broadcast scan completed. Any newly powered controllers will appear automatically.";
                    renderSettingsPairing();
                }, 1500);
            });
        }


    };

    // Modal Wizard: Dynamic Room & Pin-to-Device Mapping
    const openPairingWizardModal = (node) => {
        const modal = document.getElementById("pairing-config-modal");
        if (!modal) return;

        // Set Telemetry Details
        const idEl = document.getElementById("pair-node-id");
        const macEl = document.getElementById("pair-node-mac");
        const ipEl = document.getElementById("pair-node-ip");
        const rssiEl = document.getElementById("pair-node-rssi");
        if (idEl) idEl.textContent = node.nodeId;
        if (macEl) macEl.textContent = node.mac || "24:6F:28:XX:XX:XX";
        if (ipEl) ipEl.textContent = node.ip || "192.168.1.x";
        if (rssiEl) rssiEl.textContent = `${node.rssi || -52} dBm`;

        // Populate Room Selector
        const roomSelect = document.getElementById("pair-room-select");
        const newRoomBox = document.getElementById("pair-new-room-fields");
        const newRoomName = document.getElementById("pair-new-room-name");
        if (newRoomBox) newRoomBox.style.display = "none";
        if (newRoomName) newRoomName.value = "";

        if (roomSelect) {
            roomSelect.innerHTML = `
                <option value="" disabled ${!node.pairedRoom ? 'selected' : ''}>-- Select a Room --</option>
                ${rooms.map(r => `<option value="${r.id}" ${node.pairedRoom === r.id ? 'selected' : ''}>${r.name}</option>`).join('')}
                <option value="__create_new__">➕ + Create New Room...</option>
            `;

            roomSelect.onchange = () => {
                if (roomSelect.value === "__create_new__") {
                    if (newRoomBox) newRoomBox.style.display = "flex";
                    if (newRoomName) newRoomName.focus();
                } else {
                    if (newRoomBox) newRoomBox.style.display = "none";
                }
            };
        }

        // Render Dynamic Pin Mappings
        const channelStack = document.getElementById("pair-channel-stack");
        const ALL_ESP32_PINS = [4, 5, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 12, 13, 14, 15, 2];
        const defaultPins = node.relays || [4, 5, 18, 19, 21];
        const defaultChannelNames = ["Main Light", "Secondary Light", "Ceiling Fan", "Balcony Light", "Power Socket", "Aux Switch", "Pendant Light", "Heater"];
        const defaultTypes = ["light", "light", "fan", "light", "socket", "switch", "light", "socket"];

        // Check if node already has existing devices mapped
        const existingDevices = node.pairedRoom ? devices.filter(d => d.room === node.pairedRoom) : [];

        if (channelStack) {
            channelStack.innerHTML = defaultPins.map((pin, idx) => {
                const existing = existingDevices[idx];
                const initialName = existing ? existing.name : (defaultChannelNames[idx] || `Channel ${idx + 1}`);
                const initialType = existing ? existing.type : (defaultTypes[idx] || "light");
                const currentPin = existing && existing.gpio ? existing.gpio : pin;

                return `
                    <div class="channel-pin-row" data-channel-idx="${idx}" data-pin="${currentPin}">
                        <div class="channel-gpio-wrap">
                            <span class="channel-ch-badge">CH ${idx + 1}</span>
                            <select class="channel-gpio-select" title="Assign GPIO Pin">
                                ${ALL_ESP32_PINS.map(p => `<option value="${p}" ${p === currentPin ? 'selected' : ''}>GPIO ${p}</option>`).join('')}
                            </select>
                        </div>
                        <input type="text" class="channel-name-input" placeholder="Device Name" value="${initialName}" required>
                        <select class="channel-type-select">
                            <option value="light" ${initialType === 'light' ? 'selected' : ''}>💡 Light</option>
                            <option value="fan" ${initialType === 'fan' ? 'selected' : ''}>🌀 Fan</option>
                            <option value="socket" ${initialType === 'socket' ? 'selected' : ''}>🔌 Socket</option>
                            <option value="ac" ${initialType === 'ac' ? 'selected' : ''}>❄️ AC Unit</option>
                            <option value="tv" ${initialType === 'tv' ? 'selected' : ''}>📺 TV</option>
                            <option value="switch" ${initialType === 'switch' ? 'selected' : ''}>🔘 Switch</option>
                        </select>
                        <div class="channel-toggle-wrap">
                            <input type="checkbox" class="channel-toggle-input" checked title="Enable/Disable Channel">
                        </div>
                    </div>
                `;
            }).join('');

            // Toggle visual state on checkbox change
            channelStack.querySelectorAll(".channel-toggle-input").forEach(chk => {
                chk.addEventListener("change", () => {
                    const row = chk.closest(".channel-pin-row");
                    if (row) {
                        row.classList.toggle("is-disabled", !chk.checked);
                        const input = row.querySelector(".channel-name-input");
                        const select = row.querySelector(".channel-type-select");
                        const gpioSel = row.querySelector(".channel-gpio-select");
                        if (input) input.disabled = !chk.checked;
                        if (select) select.disabled = !chk.checked;
                        if (gpioSel) gpioSel.disabled = !chk.checked;
                    }
                });
            });

            // Update row data-pin when user changes GPIO dropdown
            channelStack.querySelectorAll(".channel-gpio-select").forEach(sel => {
                sel.addEventListener("change", () => {
                    const row = sel.closest(".channel-pin-row");
                    if (row) row.dataset.pin = sel.value;
                });
            });
        }

        // Identify Button inside modal
        const identBtn = document.getElementById("btn-pair-identify");
        if (identBtn) {
            identBtn.onclick = async () => {
                identBtn.disabled = true;
                identBtn.innerHTML = `<span class="material-symbols-outlined">notifications_active</span> Blinking...`;
                await fetch("/api/nodes/identify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nodeId: node.nodeId })
                });
                showToast(`Flashing onboard LED on ${node.nodeId}`, "lightbulb");
                setTimeout(() => {
                    identBtn.disabled = false;
                    identBtn.innerHTML = `<span class="material-symbols-outlined">lightbulb</span> Blink LED`;
                }, 4000);
            };
        }

        // Close handlers
        const closeBtn = document.getElementById("pair-modal-close-btn");
        const cancelBtn = document.getElementById("pair-modal-cancel-btn");
        const closeModal = () => modal.close();
        if (closeBtn) closeBtn.onclick = closeModal;
        if (cancelBtn) cancelBtn.onclick = closeModal;

        // Form Submit: Deploy Configuration to ESP32
        const form = document.getElementById("pairing-wizard-form");
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();

                let selectedRoomId = roomSelect.value;
                let newRoomTitle = null;
                let newRoomIcon = "meeting_room";

                if (selectedRoomId === "__create_new__") {
                    const nameVal = (newRoomName ? newRoomName.value : "").trim();
                    if (!nameVal) {
                        showToast("Please enter a room name.", "warning");
                        if (newRoomName) newRoomName.focus();
                        return;
                    }
                    newRoomTitle = nameVal;
                    selectedRoomId = nameVal.toLowerCase().replace(/[^a-z0-9]/g, "-");
                    const iconSelect = document.getElementById("pair-new-room-icon");
                    if (iconSelect) newRoomIcon = iconSelect.value;
                }

                if (!selectedRoomId) {
                    showToast("Please select or create a room.", "warning");
                    return;
                }

                // Extract Pin Mappings
                const pinRows = channelStack.querySelectorAll(".channel-pin-row");
                const pinMappings = [];

                pinRows.forEach(row => {
                    const chk = row.querySelector(".channel-toggle-input");
                    if (chk && chk.checked) {
                        const gpioSelect = row.querySelector(".channel-gpio-select");
                        const pin = gpioSelect ? parseInt(gpioSelect.value, 10) : parseInt(row.dataset.pin, 10);
                        const name = row.querySelector(".channel-name-input").value.trim();
                        const type = row.querySelector(".channel-type-select").value;
                        if (name) {
                            pinMappings.push({
                                pin,
                                name,
                                type,
                                deviceId: `device-${selectedRoomId}-${pin}`
                            });
                        }
                    }
                });

                if (pinMappings.length === 0) {
                    showToast("Please configure at least one active channel.", "warning");
                    return;
                }

                const submitBtn = document.getElementById("btn-pair-submit");
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = "Deploying to ESP32...";
                }

                try {
                    const res = await fetch("/api/nodes/pair", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            nodeId: node.nodeId,
                            roomId: selectedRoomId,
                            roomName: newRoomTitle,
                            roomIcon: newRoomIcon,
                            pinMappings
                        })
                    });

                    if (res.ok) {
                        const result = await res.json();
                        modal.close();
                        showToast(`Node '${node.nodeId}' successfully paired to ${result.room.name || selectedRoomId}!`, "check_circle");
                        await fetchRooms();
                        await fetchDevices();
                        await renderSettingsPairing();
                    } else {
                        const err = await res.json();
                        showToast(err.error || "Pairing failed", "error", true);
                    }
                } catch (err) {
                    showToast("Failed to pair node: " + err.message, "error", true);
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Save & Deploy to ESP32";
                    }
                }
            };
        }

        modal.showModal();
    };

    // Sub-Section 7: Database & Backup
    const renderSettingsDatabase = () => {
        const detailPane = document.getElementById("settings-detail-pane");
        if (!detailPane) return;

        const db = (settingsData && settingsData.database) || {
            engine: "Embedded In-Memory / JSON",
            sizeKb: 1420,
            retentionDays: 30,
            lastBackup: new Date().toLocaleDateString(),
            eventsCount: 48
        };

        detailPane.innerHTML = `
            <div class="settings-section-header">
                <div class="settings-header-left">
                    <div class="settings-pane-icon">
                        <span class="material-symbols-outlined">database</span>
                    </div>
                    <div class="settings-header-titles">
                        <h2>Database & Backup</h2>
                        <p>Telemetry storage, historical retention, and disaster recovery</p>
                    </div>
                </div>
            </div>

            <div class="backup-cards-grid">
                <div class="backup-info-card">
                    <span class="backup-metric-label">Database Engine</span>
                    <span class="backup-metric-val" style="font-size: 1.1rem;">${db.engine}</span>
                </div>
                <div class="backup-info-card">
                    <span class="backup-metric-label">Active Storage Size</span>
                    <span class="backup-metric-val" style="font-size: 1.1rem;">${(db.sizeKb / 1024).toFixed(2)} MB</span>
                </div>
                <div class="backup-info-card">
                    <span class="backup-metric-label">Audit Log Records</span>
                    <span class="backup-metric-val" style="font-size: 1.1rem;">${db.eventsCount || 48} events</span>
                </div>
                <div class="backup-info-card">
                    <span class="backup-metric-label">Log Retention</span>
                    <span class="backup-metric-val" style="font-size: 1.1rem;">${db.retentionDays} Days</span>
                </div>
            </div>

            <div class="backup-actions-card">
                <div class="backup-actions-left">
                    <span class="backup-action-title">Download Full System Snapshot</span>
                    <span class="backup-action-desc">Export all devices, custom rooms, automations, and settings as JSON</span>
                </div>
                <a href="/api/settings/backup" download="smarthome-backup.json" class="btn-manage-primary" style="text-decoration: none;">
                    <span class="material-symbols-outlined">download</span>
                    <span>Export JSON</span>
                </a>
            </div>

            <div class="backup-actions-card">
                <div class="backup-actions-left">
                    <span class="backup-action-title">Restore from Backup</span>
                    <span class="backup-action-desc">Reinstate rooms and devices from a previous JSON snapshot</span>
                </div>
                <label class="btn-settings-ghost" style="display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer;">
                    <span class="material-symbols-outlined" style="font-size: 1rem;">upload</span>
                    <span>Upload JSON</span>
                    <input type="file" id="upload-backup-file" accept=".json" style="display: none;">
                </label>
            </div>
        `;

        const fileInput = document.getElementById("upload-backup-file");
        if (fileInput) {
            fileInput.addEventListener("change", (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (evt) => {
                    try {
                        const parsed = JSON.parse(evt.target.result);
                        const res = await fetch("/api/settings/restore", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ backup: parsed })
                        });
                        if (res.ok) {
                            showToast("Configuration restored successfully!", "check_circle");
                            fetchDevices();
                            fetchRooms();
                            fetchSettings();
                        } else {
                            showToast("Invalid backup file.", "error", true);
                        }
                    } catch (err) {
                        showToast("Failed to parse JSON file.", "error", true);
                    }
                };
                reader.readAsText(file);
            });
        }
    };

    // Sub-Section 8: Appearance & Themes
    const renderSettingsTheme = () => {
        const detailPane = document.getElementById("settings-detail-pane");
        if (!detailPane) return;

        const currentPreset = (settingsData && settingsData.theme && settingsData.theme.preset) || "warm";

        detailPane.innerHTML = `
            <div class="settings-section-header">
                <div class="settings-header-left">
                    <div class="settings-pane-icon">
                        <span class="material-symbols-outlined">palette</span>
                    </div>
                    <div class="settings-header-titles">
                        <h2>Appearance & Themes</h2>
                        <p>Personalize background tones, interface accents, and dark mode</p>
                    </div>
                </div>
            </div>

            <div class="theme-cards-grid">
                <div class="theme-option-card ${currentPreset === 'apple' ? 'active' : ''}" data-preset="apple">
                    <div class="theme-preview-box theme-preview-apple">
                        <span class="material-symbols-outlined" style="font-size: 1.75rem;">light_mode</span>
                    </div>
                    <div class="theme-label-row">
                        <span class="theme-name">Apple Pure Light</span>
                        <span class="material-symbols-outlined theme-check-icon">check_circle</span>
                    </div>
                </div>

                <div class="theme-option-card ${currentPreset === 'warm' ? 'active' : ''}" data-preset="warm">
                    <div class="theme-preview-box theme-preview-warm">
                        <span class="material-symbols-outlined" style="font-size: 1.75rem; color: #b45309;">wb_twilight</span>
                    </div>
                    <div class="theme-label-row">
                        <span class="theme-name">Warm Cream</span>
                        <span class="material-symbols-outlined theme-check-icon">check_circle</span>
                    </div>
                </div>

                <div class="theme-option-card ${currentPreset === 'midnight' ? 'active' : ''}" data-preset="midnight">
                    <div class="theme-preview-box theme-preview-midnight">
                        <span class="material-symbols-outlined" style="font-size: 1.75rem; color: #38bdf8;">dark_mode</span>
                    </div>
                    <div class="theme-label-row">
                        <span class="theme-name">Midnight Obsidian</span>
                        <span class="material-symbols-outlined theme-check-icon">check_circle</span>
                    </div>
                </div>
            </div>
        `;

        detailPane.querySelectorAll(".theme-option-card").forEach(card => {
            card.addEventListener("click", async () => {
                const preset = card.dataset.preset;
                applyTheme(preset);
                if (settingsData && settingsData.theme) settingsData.theme.preset = preset;
                await fetch("/api/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ section: "theme", data: { preset } })
                });
                showToast(`Theme switched to ${card.querySelector(".theme-name").textContent}`, "palette");
                renderSettingsTheme();
            });
        });
    };

    // Sub-Section 8b: Weather & Hyper-Local Location (Open-Meteo Integration)
    const renderSettingsWeather = () => {
        const detailPane = document.getElementById("settings-detail-pane");
        if (!detailPane) return;

        const wCfg = (settingsData && settingsData.weather) || {
            city: "New Delhi",
            country: "India",
            latitude: 28.6139,
            longitude: 77.2090,
            autoLocation: true
        };

        detailPane.innerHTML = `
            <div class="settings-section-header">
                <div class="settings-header-left">
                    <div class="settings-pane-icon">
                        <span class="material-symbols-outlined">cloud</span>
                    </div>
                    <div class="settings-header-titles">
                        <h2>Weather & Hyper-Local Location</h2>
                        <p>Real-time Open-Meteo forecasting (ECMWF 9km Grid) and Indian Air Quality (AQI) tracking</p>
                    </div>
                </div>
            </div>

            <div class="settings-card" style="margin-bottom: 1.5rem;">
                <div class="settings-card-header">
                    <div>
                        <h3>Active Dashboard Location</h3>
                        <p>Used to calculate hyper-local weather, sunrise/sunset, and outdoor air particulates</p>
                    </div>
                    <button type="button" class="btn-primary" id="btn-detect-gps" style="display:flex; align-items:center; gap:0.5rem; padding: 0.6rem 1.1rem; border-radius: 12px;">
                        <span class="material-symbols-outlined" style="font-size:1.1rem;">my_location</span>
                        <span>Detect GPS Location</span>
                    </button>
                </div>

                <div class="weather-active-preview" style="display:flex; align-items:center; justify-content:space-between; padding:1.25rem; background:rgba(255,255,255,0.03); border:1px solid var(--color-border); border-radius:16px; margin-top:1rem;">
                    <div style="display:flex; align-items:center; gap:1rem;">
                        <div style="width:48px; height:48px; border-radius:14px; background:rgba(16,185,129,0.12); display:flex; align-items:center; justify-content:center; color:#10b981;">
                            <span class="material-symbols-outlined" style="font-size:1.75rem;">location_on</span>
                        </div>
                        <div>
                            <h4 style="margin:0; font-size:1.1rem; font-weight:700;" id="preview-weather-city">${wCfg.city || "New Delhi"}, ${wCfg.country || "India"}</h4>
                            <p style="margin:0.25rem 0 0; font-size:0.82rem; color:var(--color-text-secondary);" id="preview-weather-coords">
                                Coordinates: ${Number(wCfg.latitude).toFixed(4)}°N, ${Number(wCfg.longitude).toFixed(4)}°E
                            </p>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <span class="badge-status status-online" style="display:inline-flex; align-items:center; gap:0.35rem; padding:0.25rem 0.65rem; border-radius:20px; font-size:0.75rem; font-weight:600; background:rgba(48,209,88,0.12); color:#30d158;">
                            <span class="status-dot"></span> Open-Meteo Active
                        </span>
                        <p style="margin:0.25rem 0 0; font-size:0.75rem; color:var(--color-text-secondary);">15-min cached sync</p>
                    </div>
                </div>
            </div>

            <div class="settings-card">
                <div class="settings-card-header">
                    <div>
                        <h3>Change Location or Search City</h3>
                        <p>Search any Indian city, pin code, or custom geographic coordinates</p>
                    </div>
                </div>

                <div class="form-group" style="position:relative; margin-top:1rem;">
                    <label for="weather-search-input">Search Indian or Global City</label>
                    <div style="position:relative;">
                        <input type="text" id="weather-search-input" placeholder="e.g. Noida, Indiranagar Bangalore, South Delhi, Mumbai, Pune..." autocomplete="off" style="padding-left:2.5rem; width:100%; box-sizing:border-box;">
                        <span class="material-symbols-outlined" style="position:absolute; left:0.85rem; top:50%; transform:translateY(-50%); font-size:1.2rem; color:var(--color-text-secondary); pointer-events:none;">search</span>
                    </div>
                    <div id="weather-search-results" class="search-autocomplete-dropdown" style="display:none; position:absolute; top:100%; left:0; right:0; background:var(--color-surface, #ffffff); border:1px solid var(--color-border); border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,0.15); z-index:100; max-height:220px; overflow-y:auto; margin-top:0.35rem;"></div>
                </div>

                <form id="weather-config-form" style="margin-top:1.25rem;">
                    <div class="form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                        <div class="form-group">
                            <label for="weather-lat-input">Latitude (°N)</label>
                            <input type="number" step="0.0001" id="weather-lat-input" value="${wCfg.latitude}" required>
                        </div>
                        <div class="form-group">
                            <label for="weather-lon-input">Longitude (°E)</label>
                            <input type="number" step="0.0001" id="weather-lon-input" value="${wCfg.longitude}" required>
                        </div>
                    </div>
                    <div class="form-group" style="margin-top:0.75rem;">
                        <label for="weather-city-input">Display City Name</label>
                        <input type="text" id="weather-city-input" value="${wCfg.city || ''}" placeholder="e.g. Noida, Sector 62" required>
                    </div>

                    <div style="margin-top:1.5rem; display:flex; justify-content:flex-end;">
                        <button type="submit" class="btn-primary" id="btn-save-weather" style="padding:0.75rem 1.5rem; border-radius:12px;">
                            Save & Sync Weather
                        </button>
                    </div>
                </form>
            </div>
        `;

        // Attach event listeners for Geolocation, Autocomplete search, and Form submit
        const detectBtn = document.getElementById("btn-detect-gps");
        const searchInput = document.getElementById("weather-search-input");
        const searchResults = document.getElementById("weather-search-results");
        const latInput = document.getElementById("weather-lat-input");
        const lonInput = document.getElementById("weather-lon-input");
        const cityInput = document.getElementById("weather-city-input");
        const form = document.getElementById("weather-config-form");

        if (detectBtn) {
            detectBtn.addEventListener("click", () => {
                if (!navigator.geolocation) {
                    showToast("Geolocation is not supported by your browser.", "error", true);
                    return;
                }
                detectBtn.disabled = true;
                detectBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:1.1rem; animation: spin 1s linear infinite;">sync</span><span>Detecting GPS...</span>`;

                navigator.geolocation.getCurrentPosition(
                    async (pos) => {
                        detectBtn.disabled = false;
                        detectBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:1.1rem;">my_location</span><span>Detect GPS Location</span>`;

                        const lat = pos.coords.latitude;
                        const lon = pos.coords.longitude;
                        latInput.value = lat.toFixed(4);
                        lonInput.value = lon.toFixed(4);
                        cityInput.value = "My Home Coordinates";
                        showToast(`GPS Location detected: ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, "my_location");
                    },
                    (err) => {
                        detectBtn.disabled = false;
                        detectBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:1.1rem;">my_location</span><span>Detect GPS Location</span>`;
                        showToast("Could not retrieve GPS: " + err.message, "error", true);
                    },
                    { timeout: 8000, enableHighAccuracy: true }
                );
            });
        }

        // Live city search autocomplete
        let debounceTimer;
        if (searchInput && searchResults) {
            searchInput.addEventListener("input", () => {
                clearTimeout(debounceTimer);
                const q = searchInput.value.trim();
                if (q.length < 2) {
                    searchResults.style.display = "none";
                    searchResults.innerHTML = "";
                    return;
                }
                debounceTimer = setTimeout(async () => {
                    try {
                        const r = await fetch(`/api/weather/search?query=${encodeURIComponent(q)}`);
                        if (!r.ok) return;
                        const resJson = await r.json();
                        const list = resJson.results || [];
                        if (list.length === 0) {
                            searchResults.innerHTML = `<div style="padding:0.75rem 1rem; font-size:0.85rem; color:var(--color-text-secondary);">No cities found for "${q}"</div>`;
                            searchResults.style.display = "block";
                            return;
                        }
                        searchResults.innerHTML = list.map(item => `
                            <div class="search-result-item" data-lat="${item.latitude}" data-lon="${item.longitude}" data-name="${item.name}" data-country="${item.country}" data-admin="${item.admin}" style="padding:0.65rem 1rem; border-bottom:1px solid var(--color-border); cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                                <div>
                                    <strong style="display:block; font-size:0.9rem;">${item.name}</strong>
                                    <span style="font-size:0.78rem; color:var(--color-text-secondary);">${item.admin ? item.admin + ', ' : ''}${item.country}</span>
                                </div>
                                <span style="font-size:0.75rem; color:var(--color-text-secondary);">${item.latitude.toFixed(2)}°, ${item.longitude.toFixed(2)}°</span>
                            </div>
                        `).join("");
                        searchResults.style.display = "block";

                        searchResults.querySelectorAll(".search-result-item").forEach(itemEl => {
                            itemEl.addEventListener("click", () => {
                                const lat = parseFloat(itemEl.dataset.lat);
                                const lon = parseFloat(itemEl.dataset.lon);
                                const name = itemEl.dataset.name;
                                const country = itemEl.dataset.country;
                                latInput.value = lat.toFixed(4);
                                lonInput.value = lon.toFixed(4);
                                cityInput.value = name;
                                searchInput.value = `${name}, ${country}`;
                                searchResults.style.display = "none";
                            });
                        });
                    } catch (e) {
                        console.error("City search failed:", e);
                    }
                }, 250);
            });

            document.addEventListener("click", (evt) => {
                if (!searchInput.contains(evt.target) && !searchResults.contains(evt.target)) {
                    searchResults.style.display = "none";
                }
            });
        }

        // Form Submit
        if (form) {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                const lat = parseFloat(latInput.value);
                const lon = parseFloat(lonInput.value);
                const city = cityInput.value.trim() || "My Location";

                const newWeatherConfig = {
                    city,
                    country: "India",
                    latitude: lat,
                    longitude: lon,
                    autoLocation: false
                };

                try {
                    const saveBtn = document.getElementById("btn-save-weather");
                    if (saveBtn) {
                        saveBtn.disabled = true;
                        saveBtn.textContent = "Saving...";
                    }
                    const r = await fetch("/api/settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ section: "weather", data: newWeatherConfig })
                    });
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.textContent = "Save & Sync Weather";
                    }
                    if (r.ok) {
                        if (settingsData) settingsData.weather = newWeatherConfig;
                        showToast(`Location updated to ${city}!`, "cloud");
                        renderSettingsWeather();
                        fetchAndRenderWeather(true); // force fresh weather fetch
                    } else {
                        showToast("Failed to save location settings.", "error", true);
                    }
                } catch (err) {
                    showToast("Error saving location: " + err.message, "error", true);
                }
            });
        }
    };

    // Sub-Section 9: Security & Account (Home Members & Access Control Hub)
    const renderSettingsAccount = async () => {
        const detailPane = document.getElementById("settings-detail-pane");
        if (!detailPane) return;

        let membersList = [];
        try {
            const memRes = await fetch("/api/members");
            if (memRes.ok) membersList = await memRes.json();
        } catch (e) {
            console.warn("Could not fetch members list:", e);
        }

        const acc = (settingsData && settingsData.account) || {
            name: currentProfile.name || "Abhishant",
            email: currentProfile.email || "abhi@smarthome.local",
            role: currentProfile.role || "Home Administrator",
            pinCode: currentProfile.pinCode || "1234",
            webhookSecret: currentProfile.webhookSecret || "sh_sec_892348a8f1e09"
        };

        const fallbackImg = "Assets/Images/kitty.png";
        const currentAvatar = currentProfile.avatarUrl || fallbackImg;
        const hasCustomAvatar = !!currentProfile.avatarUrl;

        // Build HTML for Members Directory Cards
        const membersHtml = membersList.map(m => {
            const isOwner = !!m.isOwner;
            const roleClass = m.role === "admin" ? "role-admin" : (m.role === "guest" ? "role-guest" : "role-family");
            const roleIcon = m.role === "admin" ? "shield_person" : (m.role === "guest" ? "person_pin" : "family_restroom");
            const avatarHtml = m.avatarUrl 
                ? `<img src="${m.avatarUrl}" alt="${m.name}">`
                : `<span class="material-symbols-outlined">${roleIcon}</span>`;

            // Permitted rooms display
            const roomsText = (m.permittedRooms && m.permittedRooms.includes("*"))
                ? "All Rooms"
                : (m.permittedRooms && m.permittedRooms.length ? m.permittedRooms.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(", ") : "None");

            return `
                <div class="member-card" data-id="${m.id}">
                    <div class="member-card-left">
                        <div class="member-avatar-circle">
                            ${avatarHtml}
                        </div>
                        <div class="member-info-column">
                            <div class="member-name-row">
                                <span class="member-name">${m.name}</span>
                                ${isOwner ? '<span class="member-owner-badge">Owner</span>' : ''}
                            </div>
                            <div class="member-meta-row">
                                <span class="member-role-badge ${roleClass}">
                                    <span class="material-symbols-outlined" style="font-size: 0.85rem;">${roleIcon}</span>
                                    ${m.roleLabel || m.role}
                                </span>
                                <span>&bull;</span>
                                <span>${m.email || 'No email set'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="member-card-right">
                        <span class="member-room-pill" title="Permitted Room Access">
                            <span class="material-symbols-outlined" style="font-size: 0.85rem; vertical-align: middle; margin-right: 2px;">meeting_room</span>
                            ${roomsText}
                        </span>
                        <button type="button" class="btn-member-action btn-edit-member" data-id="${m.id}" title="Edit member permissions">
                            <span class="material-symbols-outlined">edit</span>
                        </button>
                        ${!isOwner ? `
                            <button type="button" class="btn-member-action is-delete btn-delete-member" data-id="${m.id}" data-name="${m.name}" title="Remove member">
                                <span class="material-symbols-outlined">delete</span>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join("");

        detailPane.innerHTML = `
            <div class="settings-section-header">
                <div class="settings-header-left">
                    <div class="settings-pane-icon">
                        <span class="material-symbols-outlined">shield_person</span>
                    </div>
                    <div class="settings-header-titles">
                        <h2>Security & Access Control</h2>
                        <p>Owner credentials, home members directory, guest passes, and automation webhooks</p>
                    </div>
                </div>
            </div>

            <!-- Primary Owner Profile Card -->
            <div class="account-profile-card">
                <div class="account-profile-left">
                    <div class="account-avatar-large" id="account-avatar-preview" role="button" tabindex="0" title="Click to upload profile photo">
                        <img src="${currentAvatar}" alt="${currentProfile.name || 'User'}" id="account-large-avatar-img">
                        <div class="avatar-hover-overlay">
                            <span class="material-symbols-outlined">photo_camera</span>
                        </div>
                    </div>
                    <div class="account-profile-info">
                        <span class="account-profile-name">${currentProfile.name || acc.name}</span>
                        <span class="account-profile-role">Primary Hub Administrator</span>
                    </div>
                </div>
                <div class="account-profile-actions">
                    <button type="button" class="btn-upload-avatar" id="btn-upload-photo-account">
                        <span class="material-symbols-outlined">upload</span>
                        <span>Upload Photo</span>
                    </button>
                    ${hasCustomAvatar ? `
                        <button type="button" class="btn-remove-avatar" id="btn-remove-photo-account" title="Reset to default avatar">
                            <span class="material-symbols-outlined">delete</span>
                            <span>Remove</span>
                        </button>
                    ` : ''}
                </div>
            </div>

            <!-- Owner Profile Form -->
            <form class="settings-card-form" id="account-form">
                <div class="form-field-grid">
                    <div class="settings-input-wrap">
                        <label>Owner Display Name</label>
                        <input type="text" id="acc-name" value="${currentProfile.name || acc.name}" required>
                    </div>
                    <div class="settings-input-wrap">
                        <label>System Email (Alerts & Recovery)</label>
                        <input type="email" id="acc-email" value="${currentProfile.email || acc.email}" required>
                    </div>
                    <div class="settings-input-wrap">
                        <label>Assigned System Role</label>
                        <input type="text" id="acc-role" value="Home Administrator" readonly style="background: #f5f5f7; color: #86868b; cursor: not-allowed;">
                    </div>
                    <div class="settings-input-wrap">
                        <label>Master Security PIN (4-Digits)</label>
                        <input type="password" id="acc-pin" value="${acc.pinCode || '1234'}" maxlength="4">
                    </div>
                    <div class="settings-input-wrap form-field-full">
                        <label>Automation Webhook API Secret (For Siri / Shortcuts / Alexa)</label>
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            <input type="text" id="acc-webhook" value="${acc.webhookSecret || currentProfile.webhookSecret || ''}" readonly style="flex: 1; font-family: monospace; font-size: 0.825rem;">
                            <button type="button" class="btn-settings-ghost" id="btn-copy-webhook" title="Copy secret key">
                                <span class="material-symbols-outlined" style="font-size: 1rem; vertical-align: middle;">content_copy</span>
                                <span>Copy</span>
                            </button>
                            <button type="button" class="btn-revoke-key" id="btn-revoke-webhook" title="Revoke and generate new secret key">
                                <span class="material-symbols-outlined">refresh</span>
                                <span>Revoke & Regenerate</span>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="settings-form-actions">
                    <button type="submit" class="btn-manage-primary">Save Owner Profile</button>
                </div>
            </form>

            <!-- Home Members & Guests Directory Section -->
            <div class="members-directory-container">
                <div class="members-section-header">
                    <div class="members-section-titles">
                        <h3>Home Members & Guest Directory</h3>
                        <p>Manage family accounts, guest access codes, and room-level control permissions</p>
                    </div>
                    <button type="button" class="btn-add-member" id="btn-open-add-member">
                        <span class="material-symbols-outlined">person_add</span>
                        <span>Add Member</span>
                    </button>
                </div>

                <div class="members-list-grid" id="members-list-grid">
                    ${membersHtml || '<p style="color: #86868b; font-size: 0.85rem;">No members configured yet.</p>'}
                </div>
            </div>

            <!-- Role Permissions Reference Matrix -->
            <div class="permission-matrix-section">
                <h4>Role Permission Hierarchy</h4>
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th>Capability</th>
                            <th>👑 Administrator</th>
                            <th>👨‍👩‍👧 Family Member</th>
                            <th>🚶 Guest Visitor</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Device Controls & Power</td>
                            <td>✅ All Rooms</td>
                            <td>✅ All Rooms</td>
                            <td>🔒 Permitted Rooms Only</td>
                        </tr>
                        <tr>
                            <td>Scenes & Automations</td>
                            <td>✅ Full Control</td>
                            <td>✅ Full Control</td>
                            <td>❌ Restricted</td>
                        </tr>
                        <tr>
                            <td>Energy Analytics & Logs</td>
                            <td>✅ Full Access</td>
                            <td>✅ View Only</td>
                            <td>❌ Restricted</td>
                        </tr>
                        <tr>
                            <td>Hardware Nodes & MQTT Broker</td>
                            <td>✅ Full Config</td>
                            <td>❌ Restricted</td>
                            <td>❌ Restricted</td>
                        </tr>
                        <tr>
                            <td>User Directory & PINs</td>
                            <td>✅ Full Access</td>
                            <td>❌ Restricted</td>
                            <td>❌ Restricted</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;

        // 1. Profile Avatar & Form Handlers
        const uploadBtn = document.getElementById("btn-upload-photo-account");
        const avatarPreview = document.getElementById("account-avatar-preview");
        if (uploadBtn) uploadBtn.addEventListener("click", triggerAvatarUpload);
        if (avatarPreview) avatarPreview.addEventListener("click", triggerAvatarUpload);

        const removeBtn = document.getElementById("btn-remove-photo-account");
        if (removeBtn) removeBtn.addEventListener("click", removeAvatar);

        const copyBtn = document.getElementById("btn-copy-webhook");
        if (copyBtn) {
            copyBtn.addEventListener("click", () => {
                const webhookInput = document.getElementById("acc-webhook");
                if (webhookInput && webhookInput.value) {
                    navigator.clipboard.writeText(webhookInput.value);
                    showToast("API Webhook Key copied to clipboard!", "content_copy");
                }
            });
        }

        // 2. Revoke & Regenerate Webhook Secret
        const revokeBtn = document.getElementById("btn-revoke-webhook");
        if (revokeBtn) {
            revokeBtn.addEventListener("click", async () => {
                const confirmed = await showConfirmDialog({
                    title: "Revoke Webhook Secret?",
                    message: "Existing Siri Shortcuts, Alexa, and external webhook integrations will stop working until updated with the new key.",
                    confirmText: "Revoke & Regenerate",
                    isDestructive: true,
                    icon: "key"
                });

                if (confirmed) {
                    try {
                        const res = await fetch("/api/user/webhook/regenerate", { method: "POST" });
                        const data = await res.json();
                        if (res.ok && data.success) {
                            currentProfile.webhookSecret = data.webhookSecret;
                            const webhookInput = document.getElementById("acc-webhook");
                            if (webhookInput) webhookInput.value = data.webhookSecret;
                            showToast("New Webhook Key generated & active.", "check_circle");
                        } else {
                            throw new Error(data.error || "Failed to regenerate");
                        }
                    } catch (err) {
                        console.error("[Webhook Regenerate] Error:", err);
                        showToast("Failed to rotate webhook secret", "error", true);
                    }
                }
            });
        }

        // 3. Save Owner Profile
        const form = document.getElementById("account-form");
        if (form) {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                const name = document.getElementById("acc-name").value.trim();
                const email = document.getElementById("acc-email").value.trim();
                const pinCode = document.getElementById("acc-pin").value.trim();

                try {
                    const profileRes = await fetch("/api/user/profile", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name, email, role: "Home Administrator" })
                    });
                    if (profileRes.ok) {
                        const data = await profileRes.json();
                        currentProfile = data.profile;
                        updateAllAvatars(currentProfile.avatarUrl, currentProfile.name, currentProfile.role);
                    }
                } catch (err) {}

                await fetch("/api/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ section: "account", data: { name, email, role: "Home Administrator", pinCode } })
                });

                showToast("Owner profile & credentials saved.", "check_circle");
                renderSettingsAccount();
            });
        }

        // 4. Add / Edit Member Modal Handlers
        const memberModal = document.getElementById("member-modal");
        const memberForm = document.getElementById("member-form");
        const memberEditId = document.getElementById("member-edit-id");
        const memberModalTitle = document.getElementById("member-modal-title");
        const memberNameInput = document.getElementById("member-name-input");
        const memberEmailInput = document.getElementById("member-email-input");
        const memberRoleSelect = document.getElementById("member-role-select");
        const memberPinInput = document.getElementById("member-pin-input");
        const memberRoomsContainer = document.getElementById("member-room-checkboxes");
        const memberCloseBtn = document.getElementById("member-close-btn");
        const memberCancelBtn = document.getElementById("member-cancel-btn");

        const populateRoomCheckboxes = (selectedRooms = ["*"]) => {
            if (!memberRoomsContainer) return;
            const allChecked = selectedRooms.includes("*");
            memberRoomsContainer.innerHTML = `
                <label class="member-room-check-label">
                    <input type="checkbox" value="*" id="room-check-all" ${allChecked ? 'checked' : ''}>
                    <span><strong>All Rooms (Full Access)</strong></span>
                </label>
            ` + rooms.map(r => {
                const isChecked = allChecked || selectedRooms.includes(r.id);
                return `
                    <label class="member-room-check-label">
                        <input type="checkbox" class="room-single-check" value="${r.id}" ${isChecked ? 'checked' : ''}>
                        <span>${r.name}</span>
                    </label>
                `;
            }).join("");

            const allCheck = document.getElementById("room-check-all");
            if (allCheck) {
                allCheck.addEventListener("change", (e) => {
                    const singleChecks = memberRoomsContainer.querySelectorAll(".room-single-check");
                    singleChecks.forEach(c => c.checked = e.target.checked);
                });
            }
        };

        const openAddMemberBtn = document.getElementById("btn-open-add-member");
        if (openAddMemberBtn) {
            openAddMemberBtn.addEventListener("click", () => {
                if (memberEditId) memberEditId.value = "";
                if (memberForm) memberForm.reset();
                if (memberModalTitle) memberModalTitle.textContent = "Add Home Member";
                populateRoomCheckboxes(["*"]);
                if (memberModal && typeof memberModal.showModal === "function") memberModal.showModal();
            });
        }

        if (memberCloseBtn) memberCloseBtn.addEventListener("click", () => memberModal && memberModal.close());
        if (memberCancelBtn) memberCancelBtn.addEventListener("click", () => memberModal && memberModal.close());

        // Edit Member Buttons
        document.querySelectorAll(".btn-edit-member").forEach(btn => {
            btn.addEventListener("click", () => {
                const memberId = btn.dataset.id;
                const member = membersList.find(m => m.id === memberId);
                if (!member) return;

                if (memberEditId) memberEditId.value = member.id;
                if (memberNameInput) memberNameInput.value = member.name;
                if (memberEmailInput) memberEmailInput.value = member.email || "";
                if (memberRoleSelect) memberRoleSelect.value = member.role || "family";
                if (memberPinInput) memberPinInput.value = member.pinCode || "";
                if (memberModalTitle) memberModalTitle.textContent = `Edit Member: ${member.name}`;

                populateRoomCheckboxes(member.permittedRooms || ["*"]);
                if (memberModal && typeof memberModal.showModal === "function") memberModal.showModal();
            });
        });

        // Delete Member Buttons
        document.querySelectorAll(".btn-delete-member").forEach(btn => {
            btn.addEventListener("click", async () => {
                const memberId = btn.dataset.id;
                const memberName = btn.dataset.name || "this member";

                const confirmed = await showConfirmDialog({
                    title: `Remove ${memberName}?`,
                    message: "This member will immediately lose access to the smart home dashboard and door PINs.",
                    confirmText: "Remove Member",
                    isDestructive: true,
                    icon: "person_remove"
                });

                if (confirmed) {
                    try {
                        const res = await fetch(`/api/members/${memberId}`, { method: "DELETE" });
                        if (res.ok) {
                            showToast(`Member ${memberName} removed.`, "delete");
                            renderSettingsAccount();
                        } else {
                            const data = await res.json();
                            showToast(data.error || "Failed to remove member", "error", true);
                        }
                    } catch (err) {
                        console.error("Delete member error:", err);
                        showToast("Failed to delete member", "error", true);
                    }
                }
            });
        });

        // Member Form Submit (Create or Update)
        if (memberForm) {
            memberForm.onsubmit = async (e) => {
                e.preventDefault();
                const editId = memberEditId ? memberEditId.value : "";
                const name = memberNameInput.value.trim();
                const email = memberEmailInput.value.trim();
                const role = memberRoleSelect.value;
                const pinCode = memberPinInput.value.trim();

                const allCheck = document.getElementById("room-check-all");
                let permittedRooms = ["*"];
                if (allCheck && !allCheck.checked) {
                    const singleChecks = memberRoomsContainer.querySelectorAll(".room-single-check:checked");
                    permittedRooms = Array.from(singleChecks).map(c => c.value);
                    if (!permittedRooms.length) permittedRooms = ["*"];
                }

                try {
                    const url = editId ? `/api/members/${editId}` : "/api/members";
                    const method = editId ? "PUT" : "POST";
                    const res = await fetch(url, {
                        method,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name, email, role, pinCode, permittedRooms })
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                        if (memberModal) memberModal.close();
                        showToast(editId ? "Member updated successfully!" : "Member added successfully!", "check_circle");
                        renderSettingsAccount();
                    } else {
                        throw new Error(data.error || "Failed to save member");
                    }
                } catch (err) {
                    console.error("Save member error:", err);
                    showToast(err.message, "error", true);
                }
            };
        }
    };

    // Helper & compatibility dispatchers for settings
    const renderManageDevices = () => {
        if (currentView === "settings") {
            renderActiveSettingsView();
        }
    };

    const renderManageRooms = () => {
        if (currentView === "settings") {
            renderActiveSettingsView();
        }
    };

    const openDeviceModal = (deviceId = null) => {
        const deviceModal = document.getElementById("device-modal");
        if (!deviceModal) return;

        const modalTitle = document.getElementById("modal-title");
        const nameInput = document.getElementById("device-name-input");
        const typeSelect = document.getElementById("device-type-select");
        const roomSelect = document.getElementById("device-room-select");
        const editIdInput = document.getElementById("device-edit-id");
        const submitBtn = deviceModal.querySelector(".modal-submit-btn");

        if (roomSelect && rooms.length > 0) {
            roomSelect.innerHTML = rooms.map((r) => `<option value="${r.id}">${r.name}</option>`).join("");
        }

        if (deviceId) {
            const dev = devices.find(d => d.id === deviceId);
            if (dev) {
                if (modalTitle) modalTitle.textContent = "Edit Device Settings";
                if (editIdInput) editIdInput.value = dev.id;
                if (nameInput) nameInput.value = dev.name;
                if (typeSelect) typeSelect.value = dev.type;
                if (roomSelect) roomSelect.value = dev.room;
                if (submitBtn) submitBtn.textContent = "Save Changes";
            }
        } else {
            if (modalTitle) modalTitle.textContent = "Add Custom Device";
            if (editIdInput) editIdInput.value = "";
            if (nameInput) nameInput.value = "";
            if (typeSelect) typeSelect.value = "light";
            if (submitBtn) submitBtn.textContent = "Add to Dashboard";
        }

        deviceModal.showModal();
    };

    const openRoomModal = () => {
        const roomModal = document.getElementById("room-modal");
        if (roomModal) {
            roomModal.showModal();
        }
    };

    const updateDevice = async (id, { name, type, room }) => {
        try {
            const res = await fetch(`/api/devices/${encodeURIComponent(id)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, type, room })
            });
            if (res.ok) {
                const data = await res.json();
                const idx = devices.findIndex(d => d.id === id);
                if (idx !== -1 && data.device) {
                    devices[idx] = { ...devices[idx], ...data.device };
                }
                showToast(`"${name}" updated successfully!`, "check_circle");
            } else {
                const idx = devices.findIndex(d => d.id === id);
                if (idx !== -1) {
                    if (name) devices[idx].name = name;
                    if (type) devices[idx].type = type;
                    if (room) devices[idx].room = room;
                }
            }
        } catch (err) {
            console.warn("Backend update error, applying locally:", err);
            const idx = devices.findIndex(d => d.id === id);
            if (idx !== -1) {
                if (name) devices[idx].name = name;
                if (type) devices[idx].type = type;
                if (room) devices[idx].room = room;
            }
        }
        renderDevices();
        renderManageDevices();
        updateActiveCount();
    };

    const addDevice = async ({ name, type, room, powerWatts = 0 }) => {
        try {
            const res = await fetch("/api/devices", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, type, room })
            });
            if (res.ok) {
                const data = await res.json();
                devices.push(data.device);
                showToast(`"${name}" installed to dashboard!`, "check_circle");
            } else {
                devices.push({
                    id: "device-" + Date.now(),
                    name,
                    type,
                    room,
                    on: false,
                    powerWatts
                });
            }
        } catch (err) {
            console.warn("Backend add error, using local fallback:", err);
            devices.push({
                id: "device-" + Date.now(),
                name,
                type,
                room,
                on: false,
                powerWatts
            });
        }
        renderDevices();
        renderManageDevices();
        updateActiveCount();
    };

    // 9. API Fetch: Initial Devices Load
    const fetchDevices = async () => {
        try {
            const res = await fetch("/api/devices");
            if (res.ok) {
                devices = await res.json();
                renderDevices();
                updateActiveCount();
                if (currentView === "settings") {
                    renderManageDevices();
                    renderManageRooms();
                }
            }
        } catch (err) {
            console.warn("Using fallback local devices:", err);
            devices = [
                { id: "device-1", name: "Big Light", room: "bed", type: "light", on: false, powerWatts: 0, dimmable: true },
                { id: "device-2", name: "Small Light", room: "bed", type: "light", on: false, powerWatts: 0 },
                { id: "device-3", name: "Ceiling Fan", room: "bed", type: "fan", on: false, powerWatts: 0 },
                { id: "device-4", name: "Socket", room: "bed", type: "socket", on: false, powerWatts: 0, surgeProtected: true },
                { id: "device-5", name: "Television", room: "living", type: "tv", on: false, powerWatts: 0 }
            ];
            renderDevices();
            updateActiveCount();
        }
    };

    // 10. API Fetch: Initial Rooms Load
    const fetchRooms = async () => {
        try {
            const res = await fetch("/api/rooms");
            if (res.ok) {
                rooms = await res.json();
            }
        } catch (err) {
            console.warn("Using fallback local rooms:", err);
            rooms = [
                { id: "bed", name: "Bed", icon: "bed" },
                { id: "living", name: "Living", icon: "chair" },
                { id: "common", name: "Common", icon: "home" },
                { id: "others", name: "Others", icon: "more_horiz" }
            ];
        }
        renderRoomPillBar();
        renderManageRooms();
        renderManageDevices();
    };

    // 11. API Toggle Device
    const toggleDevice = async (id, isDirectClick = false) => {
        const device = devices.find((d) => d.id === id);
        if (!device) return;

        device.on = !device.on;
        if (!device.on) {
            device.powerWatts = 0;
        } else {
            if (device.type === "light") device.powerWatts = 42;
            else if (device.type === "fan") device.powerWatts = 55;
            else if (device.type === "tv") device.powerWatts = 110;
            else device.powerWatts = 15;
        }

        if (isDirectClick) {
            const tile = document.querySelector(`.device-tile[data-id="${id}"]`);
            if (tile) {
                tile.classList.toggle("is-active", device.on);
                const statusText = device.on ? (device.type === "fan" ? "On • Speed 3" : `On • ${device.powerWatts}W`) : "Off";
                const statusEl = tile.querySelector(".tile-status");
                if (statusEl) statusEl.textContent = statusText;

                const badgeLabel = device.dimmable ? "Dimmable" : device.surgeProtected ? "Surge Protect" : (device.type === "fan" ? "Timer: 2h" : "Smart Control");
                const secondaryWrap = tile.querySelector(".tile-secondary-info");
                if (secondaryWrap) {
                    secondaryWrap.innerHTML = `
                        <span class="info-badge">
                            <span class="material-symbols-outlined badge-icon">bolt</span>${device.on ? device.powerWatts : 0}W
                        </span>
                        <span class="info-badge">${badgeLabel}</span>
                    `;
                }

                // If checkbox was triggered programmatically, align state
                const input = tile.querySelector('.switch input[type="checkbox"]');
                if (input && input.checked !== device.on) {
                    input.checked = device.on;
                }
            }
        } else {
            renderDevices();
        }

        updateActiveCount();
        if (currentView === "settings") {
            renderManageDevices();
        }

        try {
            await fetch(`/api/devices/${id}/toggle`, { method: "PATCH" });
        } catch (err) {
            console.warn("Backend toggle sync error:", err);
        }
    };

    // 12. API Delete Device (Called safely from Settings view)
    const deleteDevice = async (id) => {
        devices = devices.filter((d) => d.id !== id);
        renderDevices();
        updateActiveCount();

        try {
            await fetch(`/api/devices/${id}`, { method: "DELETE" });
        } catch (err) {
            console.warn("Backend delete sync error:", err);
        }
    };

    // 13. API Delete Room
    const deleteRoom = async (id) => {
        const room = rooms.find((r) => r.id === id);
        if (!room) return;

        const attachedCount = devices.filter((d) => d.room.toLowerCase() === id.toLowerCase()).length;
        if (attachedCount > 0) {
            await showAlertDialog({
                title: `Cannot Delete "${room.name}"`,
                message: `This room currently contains ${attachedCount} active device(s). Please remove or reassign them before deleting this room.`,
                confirmText: "Understood",
                icon: "warning"
            });
            return;
        }

        const confirmed = await showConfirmDialog({
            title: `Delete "${room.name}" Room?`,
            message: "This room zone will be removed from your dashboard and navigation.",
            confirmText: "Delete Room",
            isDestructive: true,
            icon: "delete"
        });
        if (!confirmed) return;

        rooms = rooms.filter((r) => r.id !== id);
        renderRoomPillBar();
        renderManageRooms();
        renderManageDevices();

        try {
            const res = await fetch(`/api/rooms/${id}`, { method: "DELETE" });
            if (!res.ok) {
                const data = await res.json();
                await showAlertDialog({
                    title: "Delete Failed",
                    message: data.error || "Failed to delete room.",
                    confirmText: "Close",
                    icon: "error"
                });
            }
        } catch (err) {
            console.warn("Backend delete room error:", err);
        }
    };

    // 14. Room Telemetry Data Map & Dynamic Update
    const roomTelemetry = {
        bed: { name: "Bed Environment", temp: "23.5°", humidity: "46%", aqi: "22", tempStatus: "Comfortable", humStatus: "Optimal", aqiStatus: "Excellent" },
        living: { name: "Living Environment", temp: "24.2°", humidity: "51%", aqi: "28", tempStatus: "Comfortable", humStatus: "Optimal", aqiStatus: "Good" },
        common: { name: "Common Environment", temp: "25.0°", humidity: "49%", aqi: "31", tempStatus: "Warm", humStatus: "Optimal", aqiStatus: "Good" },
        others: { name: "Outdoor / Others", temp: "27.4°", humidity: "58%", aqi: "36", tempStatus: "Warm", humStatus: "Moderate", aqiStatus: "Moderate" }
    };

    const updateRoomTelemetry = (roomId, roomTitle) => {
        const actionsRoomName = document.getElementById("actions-room-name");
        const climateRoomName = document.getElementById("climate-room-name");
        const roomTemp = document.getElementById("room-temp");
        const roomHumidity = document.getElementById("room-humidity");
        const roomAqi = document.getElementById("room-aqi");
        const roomTempStatus = document.getElementById("room-temp-status");
        const roomHumStatus = document.getElementById("room-hum-status");
        const roomAqiStatus = document.getElementById("room-aqi-status");

        if (actionsRoomName) {
            actionsRoomName.textContent = `${roomTitle} Quick Actions`;
        }

        const data = roomTelemetry[roomId.toLowerCase()] || {
            name: `${roomTitle} Environment`,
            temp: "24.0°",
            humidity: "48%",
            aqi: "25",
            tempStatus: "Comfortable",
            humStatus: "Optimal",
            aqiStatus: "Good"
        };

        if (climateRoomName) climateRoomName.textContent = data.name;
        if (roomTemp) roomTemp.textContent = data.temp;
        if (roomHumidity) roomHumidity.textContent = data.humidity;
        if (roomAqi) roomAqi.textContent = data.aqi;
        if (roomTempStatus) {
            roomTempStatus.textContent = data.tempStatus;
            roomTempStatus.className = `metric-status ${data.tempStatus === 'Warm' ? 'status-moderate' : 'status-good'}`;
        }
        if (roomHumStatus) {
            roomHumStatus.textContent = data.humStatus;
            roomHumStatus.className = `metric-status ${data.humStatus === 'Moderate' ? 'status-moderate' : 'status-good'}`;
        }
        if (roomAqiStatus) {
            roomAqiStatus.textContent = data.aqiStatus;
            roomAqiStatus.className = `metric-status ${data.aqiStatus === 'Excellent' ? 'status-excellent' : (data.aqiStatus === 'Moderate' ? 'status-moderate' : 'status-good')}`;
        }
    };

    // 15. Dynamic Room Selector Pill Bar (Centered if <= 3, Scrollable if >= 4)
    const renderRoomPillBar = () => {
        const pillBar = document.getElementById("room-pill-bar");
        if (!pillBar) return;

        // Ensure active room is valid
        if (!rooms.some((r) => r.id === currentRoom) && rooms.length > 0) {
            currentRoom = rooms[0].id;
        }

        // Center when <= 3 rooms, flex-start when >= 4 rooms to scroll naturally
        if (rooms.length <= 3) {
            pillBar.style.justifyContent = "center";
        } else {
            pillBar.style.justifyContent = "flex-start";
        }

        pillBar.innerHTML = rooms.map((room) => {
            const isActive = room.id === currentRoom;
            return `
                <button type="button" class="room-pill ${isActive ? 'active' : ''}" role="tab" aria-selected="${isActive}" data-room="${room.id}">
                    ${room.name}
                </button>
            `;
        }).join("");

        // ---- Room Pill Slider ----
        // Create/re-inject the slider element (below pills via z-index)
        let slider = pillBar.querySelector(".room-pill-slider");
        if (!slider) {
            slider = document.createElement("span");
            slider.className = "room-pill-slider";
            pillBar.prepend(slider);
        }

        // Position slider over the currently active pill (no animation on initial placement)
        const positionSlider = (targetPill, animate) => {
            if (!targetPill || !slider) return;
            const w = targetPill.offsetWidth;
            const l = targetPill.offsetLeft;

            if (w <= 0) {
                // If layout/fonts are not calculated yet, retry on next animation frame
                requestAnimationFrame(() => positionSlider(targetPill, animate));
                return;
            }

            if (!animate) {
                slider.style.transition = "none";
            }
            slider.style.left = `${l}px`;
            slider.style.width = `${w}px`;
            pillBar.classList.add("has-slider");

            if (!animate) {
                requestAnimationFrame(() => {
                    slider.style.transition = "";
                });
            }
        };

        // Snap to initial active pill with RAF + timeout fallbacks for guaranteed layout sync
        const initialActive = pillBar.querySelector(".room-pill.active");
        if (initialActive) {
            positionSlider(initialActive, false);
            requestAnimationFrame(() => positionSlider(initialActive, false));
            setTimeout(() => positionSlider(initialActive, false), 50);
            setTimeout(() => positionSlider(initialActive, false), 200);
        }

        // Attach click listeners — update slider + active class
        pillBar.querySelectorAll(".room-pill").forEach((pill) => {
            pill.addEventListener("click", () => {
                // Update active state
                pillBar.querySelectorAll(".room-pill").forEach((p) => {
                    p.classList.remove("active");
                    p.setAttribute("aria-selected", "false");
                });
                pill.classList.add("active");
                pill.setAttribute("aria-selected", "true");

                // Slide the indicator to the new pill
                positionSlider(pill, true);

                currentRoom = pill.dataset.room;
                renderDevices();

                // Smoothly scroll clicked pill into center view within the pill bar only
                const targetLeft = pill.offsetLeft - (pillBar.clientWidth / 2) + (pill.clientWidth / 2);
                pillBar.scrollTo({ left: targetLeft, behavior: "smooth" });

                // Update Telemetry
                updateRoomTelemetry(currentRoom, pill.textContent.trim());
            });
        });
        // -------------------------

        // Initialize telemetry for current room
        const activePill = pillBar.querySelector(".room-pill.active");
        if (activePill) {
            updateRoomTelemetry(currentRoom, activePill.textContent.trim());
        }
    };

    // Re-align slider on window resize or font load
    window.addEventListener("resize", () => {
        const pillBar = document.getElementById("room-pill-bar");
        if (pillBar) {
            const active = pillBar.querySelector(".room-pill.active");
            const slider = pillBar.querySelector(".room-pill-slider");
            if (active && slider && active.offsetWidth > 0) {
                slider.style.transition = "none";
                slider.style.left = `${active.offsetLeft}px`;
                slider.style.width = `${active.offsetWidth}px`;
            }
        }
    });


    // Horizontal wheel scrolling on room pill bar for trackpads & mice (fluid & jitter-free)
    const pillBarElement = document.getElementById("room-pill-bar");
    if (pillBarElement) {
        pillBarElement.addEventListener("wheel", (e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                e.preventDefault();
                pillBarElement.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }

    // 16. Add Device Modal Controls (Opened from Management View)
    const deviceModal = document.getElementById("device-modal");
    const openAddDeviceBtn = document.getElementById("open-add-device-btn");
    const modalCloseBtn = document.getElementById("modal-close-btn");
    const modalCancelBtn = document.getElementById("modal-cancel-btn");
    const addDeviceForm = document.getElementById("add-device-form");

    if (openAddDeviceBtn && deviceModal) {
        openAddDeviceBtn.addEventListener("click", () => {
            deviceModal.showModal();
        });
    }

    const closeDeviceModal = () => {
        if (deviceModal && deviceModal.open) {
            deviceModal.close();
            if (addDeviceForm) addDeviceForm.reset();
        }
    };

    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeDeviceModal);
    if (modalCancelBtn) modalCancelBtn.addEventListener("click", closeDeviceModal);

    if (deviceModal) {
        deviceModal.addEventListener("click", (e) => {
            const rect = deviceModal.getBoundingClientRect();
            if (
                e.clientX < rect.left ||
                e.clientX > rect.right ||
                e.clientY < rect.top ||
                e.clientY > rect.bottom
            ) {
                closeDeviceModal();
            }
        });
    }

    // Submit New Device or Save Edited Device
    if (addDeviceForm) {
        addDeviceForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const editIdInput = document.getElementById("device-edit-id");
            const nameInput = document.getElementById("device-name-input");
            const typeSelect = document.getElementById("device-type-select");
            const roomSelect = document.getElementById("device-room-select");

            const editId = editIdInput ? editIdInput.value.trim() : "";
            const name = nameInput.value.trim();
            const type = typeSelect.value;
            const room = roomSelect.value;

            if (!name) return;

            if (editId) {
                await updateDevice(editId, { name, type, room });
            } else {
                await addDevice({ name, type, room });
            }
            closeDeviceModal();
        });
    }

    // 17. Add Room Modal Controls
    const roomModal = document.getElementById("room-modal");
    const openAddRoomBtn = document.getElementById("open-add-room-btn");
    const roomModalCloseBtn = document.getElementById("room-modal-close-btn");
    const roomModalCancelBtn = document.getElementById("room-modal-cancel-btn");
    const addRoomForm = document.getElementById("add-room-form");

    if (openAddRoomBtn && roomModal) {
        openAddRoomBtn.addEventListener("click", () => roomModal.showModal());
    }

    const closeRoomModal = () => {
        if (roomModal && roomModal.open) {
            roomModal.close();
            if (addRoomForm) addRoomForm.reset();
        }
    };

    if (roomModalCloseBtn) roomModalCloseBtn.addEventListener("click", closeRoomModal);
    if (roomModalCancelBtn) roomModalCancelBtn.addEventListener("click", closeRoomModal);

    if (roomModal) {
        roomModal.addEventListener("click", (e) => {
            const rect = roomModal.getBoundingClientRect();
            if (
                e.clientX < rect.left ||
                e.clientX > rect.right ||
                e.clientY < rect.top ||
                e.clientY > rect.bottom
            ) {
                closeRoomModal();
            }
        });
    }

    if (addRoomForm) {
        addRoomForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const nameInput = document.getElementById("room-name-input");
            const iconSelect = document.getElementById("room-icon-select");

            const name = nameInput.value.trim();
            const icon = iconSelect.value;
            if (!name) return;

            const cleanId = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
            const newRoom = { id: cleanId, name, icon };

            rooms.push(newRoom);
            renderRoomPillBar();
            renderManageRooms();
            closeRoomModal();

            try {
                await fetch("/api/rooms", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, icon })
                });
            } catch (err) {
                console.warn("Backend add room error:", err);
            }
        });
    }

    // 18. Room Quick Actions (Delegated to modular quick-actions.js)
    const renderDashboardQuickActions = () => {
        if (window.QuickActions && typeof window.QuickActions.renderDashboardGrid === "function") {
            window.QuickActions.renderDashboardGrid();
        }
    };

    // ==========================================================================
    // 19. Automations & Scenes Studio
    // ==========================================================================
    let automations = [];
    const automationsGrid = document.getElementById("automations-grid");
    const automationsCountText = document.getElementById("automations-count-text");

    const fetchAndRenderAutomations = async () => {
        try {
            const res = await fetch("/api/automations");
            if (res.ok) {
                automations = await res.json();
                renderAutomations();
            }
        } catch (err) {
            console.error("Failed to fetch automations:", err);
        }
    };

    const renderAutomations = () => {
        if (!automationsGrid) return;
        automationsGrid.innerHTML = "";

        if (automationsCountText) {
            automationsCountText.textContent = `${automations.length} smart routine(s) configured`;
        }

        if (automations.length === 0) {
            automationsGrid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 3rem; text-align: center; color: var(--color-text-secondary);">
                    <span class="material-symbols-outlined" style="font-size: 48px; opacity: 0.5;">schedule</span>
                    <p style="margin-top: 0.5rem; font-weight: 500;">No automations created yet. Click "Add Routine" to set one up!</p>
                </div>
            `;
            return;
        }

        automations.forEach((routine) => {
            const card = document.createElement("div");
            card.className = `automation-card ${!routine.enabled ? "disabled" : ""}`;
            card.id = `routine-card-${routine.id}`;

            const daysText = Array.isArray(routine.days) ? routine.days.join(", ") : routine.days;
            const targetRoomName = routine.targetRoom === "all" ? "All Rooms" : (routine.targetRoom.charAt(0).toUpperCase() + routine.targetRoom.slice(1));

            card.innerHTML = `
                <div class="auto-card-top">
                    <div class="auto-info-group">
                        <div class="auto-icon-pill">
                            <span class="material-symbols-outlined">${routine.icon || "schedule"}</span>
                        </div>
                        <div class="auto-text-details">
                            <h3>${routine.name}</h3>
                            <p>${routine.description}</p>
                        </div>
                    </div>
                    <label class="routine-switch" aria-label="Toggle routine ${routine.name}">
                        <input type="checkbox" class="routine-toggle" data-id="${routine.id}" ${routine.enabled ? "checked" : ""}>
                        <span class="routine-slider"></span>
                    </label>
                </div>

                <div class="auto-chips-row">
                    <span class="auto-chip">
                        <span class="material-symbols-outlined">schedule</span>
                        <span>${routine.time}</span>
                    </span>
                    <span class="auto-chip">
                        <span class="material-symbols-outlined">calendar_today</span>
                        <span>${daysText}</span>
                    </span>
                    <span class="auto-chip chip-target">
                        <span class="material-symbols-outlined">meeting_room</span>
                        <span>${targetRoomName}</span>
                    </span>
                </div>

                <div class="auto-card-bottom">
                    <button type="button" class="btn-run-routine" data-id="${routine.id}">
                        <span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span>
                        <span>Run Now</span>
                    </button>
                    <button type="button" class="btn-delete-routine" data-id="${routine.id}" aria-label="Delete routine">
                        <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
                    </button>
                </div>
            `;

            // Routine On/Off Toggle
            const toggleInput = card.querySelector(".routine-toggle");
            toggleInput.addEventListener("change", async () => {
                const isChecked = toggleInput.checked;
                card.classList.toggle("disabled", !isChecked);
                try {
                    await fetch(`/api/automations/${routine.id}/toggle`, { method: "PATCH" });
                    routine.enabled = isChecked;
                    showToast(`Routine '${routine.name}' ${isChecked ? "enabled" : "disabled"}`, "toggle_on");
                } catch (err) {
                    console.error("Toggle routine error:", err);
                    toggleInput.checked = !isChecked;
                }
            });

            // Run Now Handler
            const runBtn = card.querySelector(".btn-run-routine");
            runBtn.addEventListener("click", async () => {
                runBtn.classList.add("running");
                runBtn.innerHTML = `
                    <span class="material-symbols-outlined" style="font-size: 16px; animation: subtle-spin 1s infinite linear;">sync</span>
                    <span>Running...</span>
                `;

                try {
                    const res = await fetch(`/api/automations/${routine.id}/trigger`, { method: "POST" });
                    const data = await res.json();
                    if (data.success) {
                        showToast(data.message, "check_circle");
                        await fetchDevices();
                        renderDevices();
                        updateActiveCount();
                    }
                } catch (err) {
                    console.error("Trigger routine error:", err);
                    showToast("Failed to run routine", "error", true);
                } finally {
                    setTimeout(() => {
                        runBtn.classList.remove("running");
                        runBtn.innerHTML = `
                            <span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span>
                            <span>Run Now</span>
                        `;
                    }, 800);
                }
            });

            // Delete Routine Handler
            const deleteBtn = card.querySelector(".btn-delete-routine");
            deleteBtn.addEventListener("click", async () => {
                const confirmed = await showConfirmDialog({
                    title: `Delete Routine "${routine.name}"?`,
                    message: "This scheduled automation trigger will be permanently removed.",
                    confirmText: "Delete Routine",
                    cancelText: "Cancel",
                    isDestructive: true,
                    icon: "delete"
                });
                if (!confirmed) return;
                try {
                    const res = await fetch(`/api/automations/${routine.id}`, { method: "DELETE" });
                    if (res.ok) {
                        automations = automations.filter(a => a.id !== routine.id);
                        renderAutomations();
                        showToast(`Routine '${routine.name}' deleted`, "delete");
                    }
                } catch (err) {
                    console.error("Delete routine error:", err);
                    showToast("Failed to delete routine", "error", true);
                }
            });

            automationsGrid.appendChild(card);
        });
    };

    // Add Routine Modal Controls
    const routineModal = document.getElementById("routine-modal");
    const openAddRoutineBtn = document.getElementById("open-add-routine-btn");
    const routineModalCloseBtn = document.getElementById("routine-modal-close-btn");
    const routineModalCancelBtn = document.getElementById("routine-modal-cancel-btn");
    const addRoutineForm = document.getElementById("add-routine-form");

    if (openAddRoutineBtn && routineModal) {
        openAddRoutineBtn.addEventListener("click", () => routineModal.showModal());
    }

    const closeRoutineModal = () => {
        if (routineModal && routineModal.open) {
            routineModal.close();
            if (addRoutineForm) addRoutineForm.reset();
        }
    };

    if (routineModalCloseBtn) routineModalCloseBtn.addEventListener("click", closeRoutineModal);
    if (routineModalCancelBtn) routineModalCancelBtn.addEventListener("click", closeRoutineModal);

    if (routineModal) {
        routineModal.addEventListener("click", (e) => {
            const rect = routineModal.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                closeRoutineModal();
            }
        });
    }

    if (addRoutineForm) {
        addRoutineForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = document.getElementById("routine-name-input").value.trim();
            const description = document.getElementById("routine-desc-input").value.trim();
            const time = document.getElementById("routine-time-input").value.trim();
            const targetRoom = document.getElementById("routine-target-select").value;
            const actionType = document.getElementById("routine-action-select").value;
            const icon = document.getElementById("routine-icon-select").value;

            if (!name) return;

            try {
                const res = await fetch("/api/automations", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, description, time, targetRoom, actionType, icon })
                });
                const data = await res.json();
                if (data.success) {
                    automations.push(data.routine);
                    renderAutomations();
                    closeRoutineModal();
                    showToast(`Routine '${name}' created!`, "add_task");
                }
            } catch (err) {
                console.error("Create routine error:", err);
                showToast("Failed to create routine", "error", true);
            }
        });
    }

    // ==========================================================================
    // 20. Energy & Power Analytics
    // ==========================================================================
    const fetchAndRenderEnergy = async () => {
        try {
            const res = await fetch("/api/energy");
            if (!res.ok) return;
            const data = await res.json();

            // Update KPI values
            const liveWattsEl = document.getElementById("energy-live-watts");
            const todayKwhEl = document.getElementById("energy-today-kwh");
            const projectedCostEl = document.getElementById("energy-projected-cost");
            const ecoRatingEl = document.getElementById("energy-eco-rating");
            const activeSubtextEl = document.getElementById("energy-active-subtext");

            if (liveWattsEl) liveWattsEl.textContent = data.liveWatts;
            if (todayKwhEl) todayKwhEl.textContent = data.todayKwh.toFixed(2);
            if (projectedCostEl) projectedCostEl.textContent = data.projectedCost.toFixed(2);
            if (ecoRatingEl) ecoRatingEl.textContent = data.ecoRating.split(" ")[0] || "A+";
            if (activeSubtextEl) activeSubtextEl.textContent = `${data.activeDevicesCount} active device(s)`;

            // Render 24-hour bar chart
            const chartWrap = document.getElementById("energy-bar-chart");
            if (chartWrap && data.hourlyProfile) {
                chartWrap.innerHTML = "";
                const maxWatt = Math.max(...data.hourlyProfile.map(p => p.watts), 100);

                data.hourlyProfile.forEach((point) => {
                    const col = document.createElement("div");
                    const heightPercent = Math.max(12, Math.round((point.watts / maxWatt) * 100));
                    const isPeak = point.watts === maxWatt;

                    col.className = `chart-bar-column ${isPeak ? "peak" : ""}`;
                    col.innerHTML = `
                        <div class="chart-bar-tooltip">${point.watts}W @ ${point.hour}</div>
                        <div class="chart-bar-fill" style="height: ${heightPercent}%;"></div>
                        <span class="chart-bar-label">${point.hour.replace(":00", "")}</span>
                    `;
                    chartWrap.appendChild(col);
                });
            }

            // Render Room Distribution Bars
            const roomBarsWrap = document.getElementById("energy-room-bars");
            if (roomBarsWrap && data.roomBreakdown) {
                roomBarsWrap.innerHTML = "";
                data.roomBreakdown.forEach((r) => {
                    const item = document.createElement("div");
                    item.className = "room-bar-item";
                    item.innerHTML = `
                        <div class="room-bar-info">
                            <span>${r.name}</span>
                            <span>${r.watts}W (${r.percent}%)</span>
                        </div>
                        <div class="room-bar-track">
                            <div class="room-bar-progress" style="width: ${r.percent}%;"></div>
                        </div>
                    `;
                    roomBarsWrap.appendChild(item);
                });
            }

            // Render Eco Tip
            if (data.ecoTips && data.ecoTips.length > 0) {
                const tip = data.ecoTips[Math.floor(Math.random() * data.ecoTips.length)];
                const tipTitle = document.getElementById("eco-tip-title");
                const tipDesc = document.getElementById("eco-tip-desc");
                if (tipTitle) tipTitle.textContent = tip.title;
                if (tipDesc) tipDesc.textContent = tip.tip;
            }
        } catch (err) {
            console.error("Failed to fetch energy analytics:", err);
        }
    };

    // ==========================================================================
    // 21. Activity & System Intelligence Center (UI Suite)
    // ==========================================================================
    let currentIntelTab = "console";
    let terminalLogs = [];
    let currentTerminalFilter = "all";
    let isTerminalAutoScroll = true;
    let isTerminalPaused = false;
    let currentTimelineFilter = "all";

    // Helper: HTML escaper for log strings
    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Subnav Tab Switching
    const intelNavPills = document.querySelectorAll("#intel-subnav-bar .intel-nav-pill");
    intelNavPills.forEach((pill) => {
        pill.addEventListener("click", () => {
            intelNavPills.forEach((p) => {
                p.classList.remove("active");
                p.setAttribute("aria-selected", "false");
            });
            pill.classList.add("active");
            pill.setAttribute("aria-selected", "true");

            const tab = pill.dataset.tab || "console";
            currentIntelTab = tab;

            document.querySelectorAll(".intel-tab-pane").forEach((pane) => pane.classList.remove("active"));
            const targetPane = document.getElementById(`intel-pane-${tab}`);
            if (targetPane) targetPane.classList.add("active");

            renderActiveIntelTab();
        });
    });

    const renderActiveIntelTab = () => {
        switch (currentIntelTab) {
            case "console":
                fetchAndRenderConsoleLogs();
                break;
            case "timeline":
                fetchAndRenderTimelineLogs();
                break;
            case "security":
                fetchAndRenderSecurityAudit();
                break;
            case "automations":
                fetchAndRenderAutomationHistory();
                break;
            case "telemetry":
                fetchAndRenderTelemetryGauges();
                break;
        }
    };

    // --------------------------------------------------------------------------
    // Sub-Tab 1: Wireless Live MQTT Console (Terminal)
    // --------------------------------------------------------------------------
    const terminalOutput = document.getElementById("terminal-output");
    const terminalScreen = document.getElementById("terminal-screen");
    const termCmdInput = document.getElementById("term-cmd-input");
    const termSendBtn = document.getElementById("term-send-btn");
    const termAutoScrollBtn = document.getElementById("term-autoscroll-btn");
    const termPauseBtn = document.getElementById("term-pause-btn");
    const termCopyBtn = document.getElementById("term-copy-btn");
    const termClearBtn = document.getElementById("term-clear-btn");

    const fetchAndRenderConsoleLogs = async () => {
        try {
            const res = await fetch("/api/logs/console");
            if (res.ok) {
                terminalLogs = await res.json();
                renderTerminalOutput();
            }
        } catch (err) {
            console.error("Failed to fetch console logs:", err);
        }
    };

    const renderTerminalOutput = () => {
        if (!terminalOutput) return;
        terminalOutput.innerHTML = "";

        const filtered = terminalLogs.filter((entry) => {
            if (currentTerminalFilter === "all") return true;
            if (currentTerminalFilter === "firmware") return entry.category === "firmware" || (entry.message && entry.message.includes("[ESP32]"));
            if (currentTerminalFilter === "mqtt") return entry.category === "mqtt" || (entry.message && entry.message.includes("[MQTT"));
            if (currentTerminalFilter === "error") return entry.level === "error" || (entry.message && (entry.message.includes("[ERROR]") || entry.message.includes("fail") || entry.message.includes("Error")));
            return true;
        });

        if (filtered.length === 0) {
            terminalOutput.innerHTML = `
                <div class="terminal-empty-state">
                    <span class="material-symbols-outlined" style="font-size: 32px; opacity: 0.3; margin-bottom: 6px;">terminal</span>
                    <span>Live console listening for ESP32 and MQTT packets...</span>
                </div>
            `;
            return;
        }

        filtered.forEach((entry) => {
            const line = document.createElement("div");
            line.className = `term-line level-${entry.level || "info"}`;

            const d = new Date(entry.timestamp || Date.now());
            const tsStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;

            let tagHtml = `<span class="term-tag tag-${entry.category || 'sys'}">[${(entry.category || 'SYS').toUpperCase()}]</span>`;
            if (entry.message && entry.message.startsWith("[")) {
                const match = entry.message.match(/^\[(.*?)\]/);
                if (match) {
                    const tagContent = match[1];
                    let tagType = "sys";
                    if (tagContent.includes("ESP32") || tagContent.includes("Relay") || tagContent.includes("Button") || tagContent.includes("Config")) tagType = "esp32";
                    else if (tagContent.includes("MQTT")) tagType = "mqtt";
                    else if (tagContent.includes("ERROR") || tagContent.includes("FAIL")) tagType = "error";
                    tagHtml = `<span class="term-tag tag-${tagType}">[${tagContent}]</span>`;
                }
            }

            let cleanMsg = entry.message || "";
            if (cleanMsg.startsWith("[")) {
                cleanMsg = cleanMsg.replace(/^\[.*?\]\s*/, "");
            }

            line.innerHTML = `
                <span class="term-ts">${tsStr}</span>
                ${tagHtml}
                <span class="term-msg">${escapeHtml(cleanMsg)}</span>
            `;
            terminalOutput.appendChild(line);
        });

        if (isTerminalAutoScroll && terminalScreen) {
            terminalScreen.scrollTop = terminalScreen.scrollHeight;
        }
    };

    const handleIncomingNodeLog = (logEntry) => {
        terminalLogs.push(logEntry);
        if (terminalLogs.length > 500) terminalLogs.shift();

        if (logEntry.nodeId) {
            const badgeName = document.getElementById("terminal-active-node-name");
            if (badgeName) badgeName.textContent = logEntry.nodeId;
        }

        if (currentIntelTab === "console" && !isTerminalPaused) {
            renderTerminalOutput();
        }
    };

    // Terminal Filter Pills
    const termFilterBtns = document.querySelectorAll("#terminal-filter-pills .term-filter-btn");
    termFilterBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            termFilterBtns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            currentTerminalFilter = btn.dataset.filter || "all";
            renderTerminalOutput();
        });
    });

    // Auto-Scroll Toggle
    if (termAutoScrollBtn) {
        termAutoScrollBtn.classList.add("active");
        termAutoScrollBtn.addEventListener("click", () => {
            isTerminalAutoScroll = !isTerminalAutoScroll;
            termAutoScrollBtn.classList.toggle("active", isTerminalAutoScroll);
            if (isTerminalAutoScroll && terminalScreen) {
                terminalScreen.scrollTop = terminalScreen.scrollHeight;
            }
            showToast(isTerminalAutoScroll ? "Terminal auto-scroll enabled" : "Auto-scroll paused", "vertical_align_bottom");
        });
    }

    // Pause Stream Toggle
    if (termPauseBtn) {
        termPauseBtn.addEventListener("click", () => {
            isTerminalPaused = !isTerminalPaused;
            termPauseBtn.classList.toggle("active", isTerminalPaused);
            const labelSpan = termPauseBtn.querySelector("span:last-child");
            const iconSpan = termPauseBtn.querySelector(".material-symbols-outlined");
            if (labelSpan) labelSpan.textContent = isTerminalPaused ? "Resume" : "Pause";
            if (iconSpan) iconSpan.textContent = isTerminalPaused ? "play_arrow" : "pause";
            if (!isTerminalPaused) renderTerminalOutput();
            showToast(isTerminalPaused ? "Terminal stream paused" : "Terminal stream resumed", isTerminalPaused ? "pause" : "play_arrow");
        });
    }

    // Copy Console Logs
    if (termCopyBtn) {
        termCopyBtn.addEventListener("click", async () => {
            if (terminalLogs.length === 0) {
                showToast("No logs to copy", "info");
                return;
            }
            const textToCopy = terminalLogs.map(l => {
                const d = new Date(l.timestamp || Date.now());
                const tsStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
                return `[${tsStr}] [${(l.category || 'SYS').toUpperCase()}] ${l.message}`;
            }).join("\n");

            try {
                await navigator.clipboard.writeText(textToCopy);
                showToast("Terminal logs copied to clipboard", "content_copy");
            } catch (err) {
                showToast("Failed to copy logs", "error", true);
            }
        });
    }

    // Clear Console Logs
    if (termClearBtn) {
        termClearBtn.addEventListener("click", async () => {
            try {
                await fetch("/api/logs/console", { method: "DELETE" });
                terminalLogs = [];
                renderTerminalOutput();
                showToast("Console cleared", "delete_sweep");
            } catch (err) {
                console.error("Failed to clear console logs:", err);
            }
        });
    }

    // Interactive Command Dispatcher
    const sendTerminalCommand = async () => {
        if (!termCmdInput) return;
        const cmd = termCmdInput.value.trim();
        if (!cmd) return;

        handleIncomingNodeLog({
            timestamp: new Date().toISOString(),
            level: "info",
            category: "cli",
            message: `[CLI → esp32-0e40] ${cmd}`
        });

        termCmdInput.value = "";

        try {
            const res = await fetch("/api/nodes/esp32-0e40/command", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command: cmd })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Sent to ESP32: "${cmd}"`, "send");
            } else {
                showToast(data.error || "Failed to send command", "error", true);
            }
        } catch (err) {
            console.error("Failed to dispatch command:", err);
            showToast("Failed to dispatch command", "error", true);
        }
    };

    if (termSendBtn) termSendBtn.addEventListener("click", sendTerminalCommand);
    if (termCmdInput) {
        termCmdInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                sendTerminalCommand();
            }
        });
    }

    // --------------------------------------------------------------------------
    // Sub-Tab 2: Device & Appliance Timeline
    // --------------------------------------------------------------------------
    const timelineStreamList = document.getElementById("timeline-stream-list");
    const clearActivityBtn = document.getElementById("clear-activity-btn");

    const fetchAndRenderTimelineLogs = async () => {
        try {
            const res = await fetch("/api/logs");
            if (!res.ok) return;
            const logs = await res.json();
            renderTimelineLogs(logs);
        } catch (err) {
            console.error("Failed to fetch timeline logs:", err);
        }
    };

    const renderTimelineLogs = (logs) => {
        if (!timelineStreamList) return;
        timelineStreamList.innerHTML = "";

        const filtered = logs.filter((log) => {
            if (currentTimelineFilter === "all") return true;
            return log.deviceType === currentTimelineFilter || (log.type && log.type === currentTimelineFilter);
        });

        if (filtered.length === 0) {
            timelineStreamList.innerHTML = `
                <div class="timeline-empty-state">
                    <span class="material-symbols-outlined" style="font-size: 38px; opacity: 0.35;">history_toggle_off</span>
                    <p style="margin-top: 0.5rem; font-weight: 500;">No device timeline events recorded under this filter.</p>
                </div>
            `;
            return;
        }

        filtered.forEach((log) => {
            const card = document.createElement("div");
            card.className = "timeline-event-card";

            const iconName = log.icon || getDeviceIcon(log.deviceType || "light");
            const relTime = formatRelativeTime(log.timestamp);
            const source = log.source || "dashboard";
            const isOn = log.title && log.title.toLowerCase().includes("on");

            card.innerHTML = `
                <div class="timeline-left">
                    <div class="timeline-icon-box ${isOn ? 'is-active' : ''}">
                        <span class="material-symbols-outlined">${iconName}</span>
                    </div>
                    <div class="timeline-details">
                        <div class="timeline-event-title">
                            <span>${escapeHtml(log.title || "Device Action")}</span>
                            ${log.room ? `<span class="timeline-room-tag">${escapeHtml(log.room)}</span>` : ""}
                        </div>
                        <div class="timeline-event-desc">${escapeHtml(log.description || "State synchronized with hardware relay")}</div>
                    </div>
                </div>
                <div class="timeline-right">
                    <span class="timeline-source-badge">${source}</span>
                    <span class="timeline-time">${relTime}</span>
                </div>
            `;
            timelineStreamList.appendChild(card);
        });
    };

    // Timeline Filter Pills
    const timelinePills = document.querySelectorAll("#timeline-filter-group .timeline-pill");
    timelinePills.forEach((pill) => {
        pill.addEventListener("click", () => {
            timelinePills.forEach((p) => p.classList.remove("active"));
            pill.classList.add("active");
            currentTimelineFilter = pill.dataset.filter || "all";
            fetchAndRenderTimelineLogs();
        });
    });

    // Clear Timeline Button
    if (clearActivityBtn) {
        clearActivityBtn.addEventListener("click", async () => {
            const confirmed = await showConfirmDialog({
                title: "Clear Device Timeline?",
                message: "This will permanently erase all device trigger records and timeline history.",
                confirmText: "Clear History",
                cancelText: "Cancel",
                isDestructive: true,
                icon: "delete"
            });
            if (!confirmed) return;
            try {
                const res = await fetch("/api/logs", { method: "DELETE" });
                if (res.ok) {
                    showToast("Device timeline cleared", "delete_sweep");
                    fetchAndRenderTimelineLogs();
                }
            } catch (err) {
                showToast("Failed to clear timeline", "error", true);
            }
        });
    }

    // --------------------------------------------------------------------------
    // Sub-Tab 3: Security & Access Audit
    // --------------------------------------------------------------------------
    const securityAuditList = document.getElementById("security-audit-list");

    const fetchAndRenderSecurityAudit = async () => {
        if (!securityAuditList) return;
        try {
            const res = await fetch("/api/logs/security");
            const secLogs = res.ok ? await res.json() : [];

            securityAuditList.innerHTML = "";
            if (secLogs.length === 0) {
                securityAuditList.innerHTML = `
                    <div class="timeline-empty-state">
                        <span class="material-symbols-outlined" style="font-size: 36px; opacity: 0.35;">shield</span>
                        <p style="margin-top: 0.5rem; font-weight: 500;">No security incidents or unauthorized events recorded.</p>
                    </div>
                `;
                return;
            }

            secLogs.forEach((item) => {
                const row = document.createElement("div");
                row.className = "sec-audit-item";
                const relTime = formatRelativeTime(item.timestamp);
                const isWarning = item.status === "warning" || item.status === "failed";

                row.innerHTML = `
                    <div class="sec-item-left">
                        <div class="sec-item-icon ${isWarning ? 'warning' : 'safe'}">
                            <span class="material-symbols-outlined">${item.icon || (isWarning ? 'warning' : 'check_circle')}</span>
                        </div>
                        <div class="sec-item-text">
                            <strong>${escapeHtml(item.title || "Authentication Check")}</strong>
                            <span>${escapeHtml(item.description || "Session verified successfully")}</span>
                        </div>
                    </div>
                    <div class="sec-item-right">
                        <span class="sec-status-badge ${item.status || 'success'}">${item.status || 'Verified'}</span>
                        <span class="sec-time">${relTime}</span>
                    </div>
                `;
                securityAuditList.appendChild(row);
            });
        } catch (err) {
            console.error("Failed to fetch security logs:", err);
        }
    };

    // --------------------------------------------------------------------------
    // Sub-Tab 4: Automations & Scene History
    // --------------------------------------------------------------------------
    const automationsHistoryList = document.getElementById("automations-history-list");

    const fetchAndRenderAutomationHistory = async () => {
        if (!automationsHistoryList) return;
        try {
            const res = await fetch("/api/logs?type=automation");
            const autoLogs = res.ok ? await res.json() : [];

            automationsHistoryList.innerHTML = "";
            if (autoLogs.length === 0) {
                automationsHistoryList.innerHTML = `
                    <div class="timeline-empty-state">
                        <span class="material-symbols-outlined" style="font-size: 38px; opacity: 0.35;">smart_toy</span>
                        <p style="margin-top: 0.5rem; font-weight: 500;">No automation triggers or scene executions recorded yet.</p>
                    </div>
                `;
                return;
            }

            autoLogs.forEach((item) => {
                const el = document.createElement("div");
                el.className = "auto-hist-item";
                const relTime = formatRelativeTime(item.timestamp);

                el.innerHTML = `
                    <div class="auto-item-left">
                        <div class="auto-item-icon">
                            <span class="material-symbols-outlined">${item.icon || 'smart_toy'}</span>
                        </div>
                        <div class="auto-item-text">
                            <strong>${escapeHtml(item.title || "Automation Triggered")}</strong>
                            <span>${escapeHtml(item.description || "Scene routine executed")}</span>
                        </div>
                    </div>
                    <div class="auto-item-right">
                        <span class="auto-badge success">Executed</span>
                        <span class="auto-time">${relTime}</span>
                    </div>
                `;
                automationsHistoryList.appendChild(el);
            });
        } catch (err) {
            console.error("Failed to fetch automation logs:", err);
        }
    };

    // --------------------------------------------------------------------------
    // Sub-Tab 5: Node Telemetry & Hardware Health
    // --------------------------------------------------------------------------
    const telemetryNodesGrid = document.getElementById("telemetry-nodes-grid");

    const fetchAndRenderTelemetryGauges = async () => {
        if (!telemetryNodesGrid) return;
        try {
            const diagRes = await fetch("/api/mqtt/diagnostics");
            const diagData = diagRes.ok ? await diagRes.json() : {};
            renderTelemetryCards(diagData);
        } catch (err) {
            console.error("Failed to fetch telemetry data:", err);
        }
    };

    const renderTelemetryCards = (diagData) => {
        if (!telemetryNodesGrid) return;
        telemetryNodesGrid.innerHTML = "";

        const roomsList = diagData.rooms || [];
        const activeNodes = [];

        roomsList.forEach((r) => {
            if (r.node) {
                activeNodes.push({
                    nodeId: r.node.nodeId || `esp32-${r.id}`,
                    room: r.name,
                    roomId: r.id,
                    status: r.node.status || "online",
                    ip: r.node.ip || "192.168.1.xxx",
                    mac: r.node.mac || "XX:XX:XX:XX:XX:XX",
                    rssi: r.node.rssi || -58,
                    freeHeap: r.node.freeHeap || 284320,
                    totalHeap: 327680,
                    uptime: r.node.uptime || 3640,
                    channels: r.channels || []
                });
            }
        });

        if (activeNodes.length === 0) {
            activeNodes.push({
                nodeId: "esp32-0e40",
                room: "Bed Room",
                roomId: "bed",
                status: "online",
                ip: "192.168.1.xxx",
                mac: "XX:XX:XX:XX:XX:XX",
                rssi: -58,
                freeHeap: 284320,
                totalHeap: 327680,
                uptime: 3640,
                channels: [
                    { gpio: 4, name: "Main Light" },
                    { gpio: 5, name: "Secondary Light" },
                    { gpio: 18, name: "Ceiling Fan" },
                    { gpio: 19, name: "Balcony Light" },
                    { gpio: 21, name: "Power Socket" }
                ]
            });
        }

        activeNodes.forEach((node) => {
            const card = document.createElement("div");
            card.className = "telem-node-card";

            const isOnline = node.status === "online";
            const rssiVal = typeof node.rssi === "number" ? node.rssi : -58;
            const rssiPercent = Math.min(100, Math.max(10, Math.round(2 * (rssiVal + 100))));
            const heapKbFree = Math.round((node.freeHeap || 284000) / 1024);
            const heapKbTotal = Math.round((node.totalHeap || 327680) / 1024);
            const heapPercent = Math.round((heapKbFree / heapKbTotal) * 100);

            const uptimeSec = node.uptime || 0;
            const hours = Math.floor(uptimeSec / 3600);
            const mins = Math.floor((uptimeSec % 3600) / 60);
            const uptimeStr = `${hours}h ${mins}m`;

            card.innerHTML = `
                <div class="telem-card-header">
                    <div class="telem-node-ident">
                        <div class="telem-node-icon">
                            <span class="material-symbols-outlined">developer_board</span>
                        </div>
                        <div>
                            <h4>${escapeHtml(node.nodeId)}</h4>
                            <span class="telem-room-pill">${escapeHtml(node.room)}</span>
                        </div>
                    </div>
                    <span class="telem-status-tag ${isOnline ? 'online' : 'offline'}">
                        <span class="dot"></span>
                        <span>${isOnline ? 'Online' : 'Offline'}</span>
                    </span>
                </div>

                <div class="telem-gauges-grid">
                    <div class="telem-gauge-item">
                        <div class="gauge-head">
                            <span class="label">Wi-Fi Signal</span>
                            <span class="val">${rssiVal} dBm (${rssiPercent}%)</span>
                        </div>
                        <div class="gauge-bar-track">
                            <div class="gauge-bar-fill wifi" style="width: ${rssiPercent}%;"></div>
                        </div>
                    </div>

                    <div class="telem-gauge-item">
                        <div class="gauge-head">
                            <span class="label">Free SRAM Heap</span>
                            <span class="val">${heapKbFree} KB / ${heapKbTotal} KB</span>
                        </div>
                        <div class="gauge-bar-track">
                            <div class="gauge-bar-fill heap" style="width: ${heapPercent}%;"></div>
                        </div>
                    </div>
                </div>

                <div class="telem-meta-row">
                    <div class="meta-col">
                        <span class="lbl">IP Address</span>
                        <strong>${escapeHtml(node.ip)}</strong>
                    </div>
                    <div class="meta-col">
                        <span class="lbl">MAC Address</span>
                        <strong>${escapeHtml(node.mac)}</strong>
                    </div>
                    <div class="meta-col">
                        <span class="lbl">Node Uptime</span>
                        <strong>${uptimeStr}</strong>
                    </div>
                </div>

                ${node.channels && node.channels.length > 0 ? `
                    <div class="telem-channels-preview">
                        <span class="lbl">Active GPIO Relays:</span>
                        <div class="telem-gpio-pills">
                            ${node.channels.map(c => `<span class="gpio-pill">GPIO ${c.gpio}: ${escapeHtml(c.name || 'Channel')}</span>`).join('')}
                        </div>
                    </div>
                ` : ''}

                <div class="telem-card-actions">
                    <button type="button" class="btn-ping-node" data-node="${escapeHtml(node.nodeId)}">
                        <span class="material-symbols-outlined">cell_tower</span>
                        <span>Send Ping / Identify</span>
                    </button>
                </div>
            `;

            const pingBtn = card.querySelector(".btn-ping-node");
            if (pingBtn) {
                pingBtn.addEventListener("click", async () => {
                    showToast(`Sending identify ping to ${node.nodeId}...`, "cell_tower");
                    try {
                        await fetch(`/api/nodes/${node.nodeId}/command`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ command: "identify" })
                        });
                        showToast(`Ping ACK received from ${node.nodeId}`, "check_circle");
                    } catch (err) {
                        showToast("Ping request failed", "error", true);
                    }
                });
            }

            telemetryNodesGrid.appendChild(card);
        });
    };

    const handleIncomingTelemetry = (data) => {
        if (currentIntelTab === "telemetry") {
            fetchAndRenderTelemetryGauges();
        }
    };

    const handleIncomingActivityLog = (log) => {
        if (currentIntelTab === "timeline") {
            fetchAndRenderTimelineLogs();
        }
    };

    // Settings Sub-Navigation Click Listeners
    document.querySelectorAll("#settings-nav-list .settings-nav-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            currentSettingsTab = btn.dataset.tab;
            fetchSettings().then(() => renderActiveSettingsView());
        });
    });

    // Connection Status Pill & Live MQTT Diagnostics Modal Triggers
    const statusPill = document.getElementById("status-pill");
    const diagModal = document.getElementById("network-diagnostics-modal");
    const diagCloseBtn = document.getElementById("diag-modal-close-btn");
    const diagDoneBtn = document.getElementById("diag-modal-done-btn");
    const diagRefreshBtn = document.getElementById("diag-refresh-btn");

    if (statusPill) {
        statusPill.addEventListener("click", () => {
            fetchAndRenderDiagnostics(false);
        });
    }

    if (diagCloseBtn) diagCloseBtn.addEventListener("click", () => diagModal && diagModal.close());
    if (diagDoneBtn) diagDoneBtn.addEventListener("click", () => diagModal && diagModal.close());
    if (diagRefreshBtn) {
        diagRefreshBtn.addEventListener("click", async () => {
            await fetchAndRenderDiagnostics(true);
            showToast("Diagnostics telemetry updated", "cell_tower");
        });
    }

    // Initial Load
    if (window.QuickActions && typeof window.QuickActions.init === "function") {
        window.QuickActions.init();
    }
    fetchUserProfile();
    initAvatarUploadEvents();
    fetchSettings();
    fetchRooms();
    fetchDevices();
    fetchAndRenderDiagnostics(true);
    // Connect SSE stream for real-time hardware → dashboard sync
    initSSE();

    // Restore active view across browser refreshes (stays on current screen)
    const savedView = localStorage.getItem("sh_active_view") || "dashboard";
    if (savedView !== "dashboard") {
        switchView(savedView);
    }
});
