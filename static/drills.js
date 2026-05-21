document.addEventListener('DOMContentLoaded', () => {
    const typeButtons = document.querySelectorAll('.drill-type-card:not(.disabled)');
    const startDrillButton = document.getElementById('startDrillButton');
    const submitButton = document.getElementById('submitDrillButton');
    const recordSpeedButton = document.getElementById('recordSpeedButton');
    const stopSpeedButton = document.getElementById('stopSpeedButton');
    const speedControls = document.getElementById('speedControls');
    const responseBox = document.getElementById('drillResponse');
    const titleEl = document.getElementById('drillTitle');
    const topicEl = document.getElementById('drillTopic');
    const promptEl = document.getElementById('drillPrompt');
    const taskEl = document.getElementById('drillTask');
    const timerInput = document.getElementById('drillTimerInput');
    const liveTimerEl = document.getElementById('drillLiveTimer');
    const feedbackEl = document.getElementById('drillFeedback');
    const responseModeLabel = document.getElementById('responseModeLabel');
    const audioResponseCard = document.getElementById('audioResponseCard');
    const speedWaveform = window.DebbyWaveform.create('speedWaveform');
    const typedDrillTypes = new Set(['contentions']);

    let currentType = null;
    let currentDrill = null;
    let timerInterval = null;
    let remainingSeconds = 0;
    let mediaRecorder = null;
    let audioChunks = [];
    let isSubmitting = false;
    let drillState = 'idle';

    function isAudioDrill() {
        return currentType && !typedDrillTypes.has(currentType);
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function parseTime(value) {
        const match = String(value || '').trim().match(/^(\d{1,2})(?::([0-5]\d))?$/);
        if (!match) {
            return 60;
        }

        const minutes = Number(match[1]);
        const seconds = Number(match[2] || 0);
        return Math.min(Math.max((minutes * 60) + seconds, 1), 600);
    }

    function setLoading(message) {
        feedbackEl.classList.remove('empty-state');
        feedbackEl.innerHTML = `
            <div class="loading-feedback">
                <img src="/static/loading.gif" alt="Loading">
                <p>${escapeHtml(message)}</p>
            </div>
        `;
    }

    function setStatus(message) {
        feedbackEl.classList.remove('empty-state');
        feedbackEl.innerHTML = `<p>${escapeHtml(message)}</p>`;
    }

    function showError(message) {
        feedbackEl.classList.remove('empty-state');
        feedbackEl.innerHTML = `<div class="auth-error">${escapeHtml(message)}</div>`;
    }

    function resetTimer(seconds) {
        clearInterval(timerInterval);
        remainingSeconds = Number(seconds || 60);
        liveTimerEl.textContent = formatTime(remainingSeconds);
        timerInput.disabled = Boolean(currentDrill);
    }

    function discardRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.onstop = null;
            try {
                mediaRecorder.stop();
            } catch (error) {
                console.error('Error discarding recording:', error);
            }
            mediaRecorder.stream.getTracks().forEach((track) => track.stop());
        }
        speedWaveform.stop();
        mediaRecorder = null;
        audioChunks = [];
    }

    function setIdleState(message = 'Select a drill to start.') {
        currentDrill = null;
        drillState = 'idle';
        discardRecording();
        clearInterval(timerInterval);
        timerInterval = null;
        remainingSeconds = 0;
        titleEl.textContent = 'Select a Drill';
        topicEl.textContent = message;
        promptEl.textContent = '';
        taskEl.textContent = '';
        timerInput.disabled = false;
        liveTimerEl.textContent = formatTime(parseTime(timerInput.value));
        responseBox.value = '';
        responseBox.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = 'Submit Response';
        recordSpeedButton.disabled = true;
        stopSpeedButton.disabled = true;
        startDrillButton.disabled = !currentType;
        startDrillButton.textContent = 'Start Drill';
        feedbackEl.classList.add('empty-state');
        feedbackEl.textContent = 'Complete a drill to see feedback here.';
        renderMode();
    }

    function startTimer() {
        if (!currentDrill || timerInterval) {
            return;
        }

        timerInterval = setInterval(() => {
            remainingSeconds -= 1;
            const displayTime = formatTime(Math.max(remainingSeconds, 0));
            liveTimerEl.textContent = displayTime;
            if (remainingSeconds <= 0) {
                clearInterval(timerInterval);
                timerInterval = null;
                handleTimerFinished();
            }
        }, 1000);
    }

    function handleTimerFinished() {
        if (isAudioDrill()) {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                stopSpeedRecording();
            } else if (currentDrill) {
                showError('Time is up. Start a new drill when you are ready.');
            }
            return;
        }

        if (currentDrill && !submitButton.disabled) {
            submitTypedDrill();
        } else if (currentDrill) {
            showError('Time is up. Write a response before submitting.');
        }
    }

    function setDrillType(type) {
        currentType = type;
        typeButtons.forEach((button) => {
            button.classList.toggle('active', button.dataset.drillType === type);
        });
        setIdleState('Press Start Drill when you are ready.');
    }

    function renderMode() {
        const audioMode = isAudioDrill();
        speedControls.hidden = !audioMode;
        responseBox.hidden = audioMode;
        audioResponseCard.hidden = !audioMode;
        submitButton.hidden = audioMode;
        if (!currentDrill) {
            responseBox.disabled = true;
        }
        responseModeLabel.textContent = audioMode
            ? currentType === 'speed'
                ? 'Record yourself reading the passage.'
                : 'Record your answer out loud.'
            : currentType
                ? 'Type your answer, then submit.'
                : 'Choose a drill, then press Start Drill.';

        if (audioMode) {
            audioResponseCard.innerHTML = audioGuidanceHtml();
        }
    }

    function audioGuidanceHtml() {
        const guidance = {
            rebuttal: {
                title: 'Rebuttal drill',
                body: 'Answer the argument directly: name the claim, attack the warrant, then explain why their impact no longer matters. Keep it organized like a short speech. Debby will transcribe and score the speech.'
            },
            speed: {
                title: 'Speed reading drill',
                body: 'Read the passage exactly as written. Push your pace while keeping words clear, punctuation controlled, and stumbles low. Debby will transcribe and score the speech.'
            },
            impact: {
                title: 'Impact extension drill',
                body: 'Extend the argument into weighing: explain magnitude, probability, timeframe, and why this impact should matter more than the other side. Debby will transcribe and score the speech.'
            }
        };
        const selected = guidance[currentType] || {
            title: 'Audio drill',
            body: 'Give a clear, organized spoken response to the prompt. Debby will transcribe and score the speech.'
        };

        return `<span>${escapeHtml(selected.title)}</span><p>${escapeHtml(selected.body)}</p>`;
    }

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Something went wrong.');
        }
        return data;
    }

    async function generateDrill() {
        currentDrill = null;
        drillState = 'loading';
        startDrillButton.disabled = true;
        startDrillButton.textContent = 'Loading...';
        submitButton.disabled = true;
        submitButton.textContent = 'Submit Response';
        recordSpeedButton.disabled = true;
        responseBox.disabled = true;
        responseBox.value = '';
        titleEl.textContent = 'Generating...';
        topicEl.textContent = '';
        promptEl.textContent = '';
        taskEl.textContent = '';
        setLoading('Building a fresh drill...');
        resetTimer(parseTime(timerInput.value));

        try {
            const data = await fetchJson('/api/generate-drill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    drill_type: currentType,
                    timer_seconds: parseTime(timerInput.value)
                })
            });

            currentDrill = data.drill;
            titleEl.textContent = currentDrill.title || 'Drill';
            topicEl.textContent = currentDrill.topic || '';
            promptEl.textContent = currentDrill.prompt || '';
            taskEl.textContent = audioTaskText(currentDrill.task || '');
            resetTimer(parseTime(timerInput.value));
            renderMode();
            submitButton.disabled = isAudioDrill();
            recordSpeedButton.disabled = !isAudioDrill();
            responseBox.disabled = isAudioDrill();
            drillState = 'active';
            startDrillButton.disabled = false;
            startDrillButton.textContent = 'Cancel';
            feedbackEl.classList.add('empty-state');
            feedbackEl.textContent = isAudioDrill()
                ? 'Start recording when you are ready. Speak clearly and stay strategic.'
                : 'Complete a drill to see feedback here.';
            if (!isAudioDrill()) {
                startTimer();
            }
        } catch (error) {
            showError(error.message);
            titleEl.textContent = 'Could not load drill';
            startDrillButton.disabled = false;
            startDrillButton.textContent = 'Start Drill';
            drillState = 'idle';
        }
    }

    function audioTaskText(task) {
        if (!isAudioDrill()) {
            return task;
        }

        if (currentType === 'speed') {
            return 'Read the passage aloud, then submit your recording.';
        }

        return 'Give your response aloud, then submit your recording.';
    }

    function renderTypedFeedback(feedback, transcript = '') {
        const strengths = (feedback.strengths || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
        const improvements = (feedback.improvements || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
        feedbackEl.classList.remove('empty-state');
        feedbackEl.innerHTML = `
            <div class="feedback-score">Score: ${escapeHtml(feedback.score)}/10</div>
            <h3>${escapeHtml(feedback.headline)}</h3>
            ${transcript ? `<strong>Transcript</strong><p>${escapeHtml(transcript)}</p>` : ''}
            <strong>What worked</strong>
            <ul>${strengths || '<li>Keep building specificity.</li>'}</ul>
            <strong>Next reps</strong>
            <ul>${improvements || '<li>Make the response more complete.</li>'}</ul>
            ${feedback.model_answer ? `<strong>Model answer</strong><p>${escapeHtml(feedback.model_answer)}</p>` : ''}
        `;
        submitButton.disabled = true;
        submitButton.textContent = 'Try Again';
        submitButton.disabled = false;
        drillState = 'complete';
        startDrillButton.disabled = true;
        startDrillButton.textContent = 'Start Drill';
        responseBox.disabled = true;
        submitButton.hidden = false;
    }

    function drawWpmGraph(series) {
        const canvas = document.getElementById('speedWpmChart');
        if (!canvas || !Array.isArray(series) || series.length === 0) {
            return;
        }

        const containerWidth = canvas.parentElement.clientWidth || 360;
        const width = Math.max(containerWidth, 280);
        const height = 190;
        const scale = window.devicePixelRatio || 1;
        canvas.width = width * scale;
        canvas.height = height * scale;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const context = canvas.getContext('2d');
        context.scale(scale, scale);
        context.clearRect(0, 0, width, height);

        const padding = { top: 18, right: 16, bottom: 42, left: 78 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;
        const maxTime = Math.max(...series.map((point) => Number(point.time) || 0), 1);
        const maxWpm = Math.max(...series.map((point) => Number(point.wpm) || 0), 60);
        const yMax = Math.ceil(maxWpm / 50) * 50;

        const xFor = (time) => padding.left + ((Number(time) || 0) / maxTime) * plotWidth;
        const yFor = (wpm) => padding.top + plotHeight - ((Number(wpm) || 0) / yMax) * plotHeight;

        context.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        context.lineWidth = 1;
        context.strokeStyle = '#d9e7e4';
        context.fillStyle = '#66817d';

        for (let tick = 0; tick <= 4; tick += 1) {
            const value = Math.round((yMax / 4) * tick);
            const y = yFor(value);
            context.beginPath();
            context.moveTo(padding.left, y);
            context.lineTo(width - padding.right, y);
            context.stroke();
            context.fillText(String(value), 36, y + 4);
        }

        const xTickCount = Math.min(Math.max(series.length - 1, 1), 6);
        for (let tick = 0; tick <= xTickCount; tick += 1) {
            const time = Math.round((maxTime / xTickCount) * tick);
            const x = xFor(time);
            context.strokeStyle = '#edf4f2';
            context.beginPath();
            context.moveTo(x, padding.top);
            context.lineTo(x, padding.top + plotHeight);
            context.stroke();
            context.fillStyle = '#66817d';
            context.fillText(`${time}s`, x - 10, height - 20);
        }

        context.strokeStyle = '#00796b';
        context.lineWidth = 3;
        context.beginPath();
        series.forEach((point, index) => {
            const x = xFor(point.time);
            const y = yFor(point.wpm);
            if (index === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        });
        context.stroke();

        context.fillStyle = '#004d40';
        series.forEach((point) => {
            context.beginPath();
            context.arc(xFor(point.time), yFor(point.wpm), 3, 0, Math.PI * 2);
            context.fill();
        });

        context.fillStyle = '#66817d';
        context.save();
        context.translate(14, padding.top + plotHeight / 2 + 16);
        context.rotate(-Math.PI / 2);
        context.fillText('WPM', 0, 0);
        context.restore();
        context.fillText('Time (seconds)', Math.max(width / 2 - 42, padding.left), height - 6);
    }

    function renderSpeedFeedback(feedback) {
        feedbackEl.classList.remove('empty-state');
        feedbackEl.innerHTML = `
            <div class="feedback-score">${escapeHtml(feedback.wpm)} WPM</div>
            <h3>${escapeHtml(feedback.headline)}</h3>
            <p><strong>Accuracy:</strong> ${escapeHtml(feedback.accuracy)}% of attempted words</p>
            <p><strong>Completion:</strong> ${escapeHtml(feedback.completion)}% of the passage</p>
            <p><strong>Duration:</strong> ${escapeHtml(feedback.duration_seconds)}s</p>
            <p><strong>Recognized words:</strong> ${escapeHtml(feedback.word_count)}</p>
            <div class="speed-chart-card">
                <strong>WPM over time</strong>
                <canvas id="speedWpmChart" aria-label="WPM over time graph"></canvas>
            </div>
            <strong>Transcript</strong>
            <p>${escapeHtml(feedback.transcript)}</p>
        `;
        drawWpmGraph(feedback.wpm_series || []);
        submitButton.hidden = false;
        submitButton.textContent = 'Try Again';
        submitButton.disabled = false;
        drillState = 'complete';
        startDrillButton.disabled = true;
        startDrillButton.textContent = 'Start Drill';
    }

    async function submitTypedDrill() {
        if (!currentDrill) {
            return;
        }
        if (isSubmitting) {
            return;
        }

        if (drillState === 'complete') {
            generateDrill();
            return;
        }

        const response = responseBox.value.trim();
        if (!response) {
            showError('Write a response before submitting.');
            return;
        }

        isSubmitting = true;
        submitButton.disabled = true;
        clearInterval(timerInterval);
        timerInterval = null;
        setLoading('Scoring your response...');

        try {
            const data = await fetchJson('/api/score-drill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    drill_type: currentType,
                    drill: currentDrill,
                    response
                })
            });
            renderTypedFeedback(data.feedback);
        } catch (error) {
            showError(error.message);
        } finally {
            isSubmitting = false;
        }
    }

    async function startSpeedRecording() {
        if (!currentDrill) {
            return;
        }

        audioChunks = [];
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? { mimeType: 'audio/webm;codecs=opus' }
                : {};
            mediaRecorder = new MediaRecorder(stream, options);
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            mediaRecorder.start();
            speedWaveform.start(stream).catch(error => {
                console.error('Error starting waveform:', error);
            });
            recordSpeedButton.disabled = true;
            stopSpeedButton.disabled = false;
            stopSpeedButton.textContent = currentType === 'speed' ? 'Stop and Score' : 'Stop and Submit';
            setStatus('Recording...');
            startTimer();
        } catch (error) {
            showError('Could not start recording. Check microphone permissions.');
        }
    }

    async function stopSpeedRecording() {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            return;
        }

        clearInterval(timerInterval);
        timerInterval = null;
        stopSpeedButton.disabled = true;
        mediaRecorder.onstop = async () => {
            speedWaveform.stop();
            mediaRecorder.stream.getTracks().forEach((track) => track.stop());
            const recordedBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const formData = new FormData();
            formData.append('audio', recordedBlob, 'drill_audio.webm');
            if (currentType === 'speed') {
                formData.append('passage', currentDrill.prompt || '');
            } else {
                formData.append('drill_type', currentType);
                formData.append('drill', JSON.stringify(currentDrill));
            }
            setLoading('Transcribing and scoring...');

            try {
                const response = await fetch(currentType === 'speed' ? '/api/score-speed-drill' : '/api/score-audio-drill', {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' },
                    body: formData
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.error || 'Could not score the recording.');
                }
                if (currentType === 'speed') {
                    renderSpeedFeedback(data.feedback);
                } else {
                    renderTypedFeedback(data.feedback, data.transcript || '');
                }
            } catch (error) {
                showError(error.message);
            } finally {
                recordSpeedButton.disabled = true;
                speedWaveform.stop();
                mediaRecorder = null;
                audioChunks = [];
            }
        };
        mediaRecorder.stop();
    }

    typeButtons.forEach((button) => {
        button.addEventListener('click', () => setDrillType(button.dataset.drillType));
    });
    startDrillButton.addEventListener('click', () => {
        if (drillState === 'active') {
            setIdleState('Press Start Drill when you are ready.');
            return;
        }

        if (!currentType) {
            setIdleState();
            return;
        }
        generateDrill();
    });
    submitButton.addEventListener('click', submitTypedDrill);
    recordSpeedButton.addEventListener('click', startSpeedRecording);
    stopSpeedButton.addEventListener('click', stopSpeedRecording);
    timerInput.addEventListener('change', () => {
        if (!currentDrill) {
            const displayTime = formatTime(parseTime(timerInput.value));
            liveTimerEl.textContent = displayTime;
        }
    });

    setIdleState();
});
