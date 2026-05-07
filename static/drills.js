document.addEventListener('DOMContentLoaded', () => {
    const typeButtons = document.querySelectorAll('.drill-type-card:not(.disabled)');
    const startDrillButton = document.getElementById('startDrillButton');
    const cancelDrillButton = document.getElementById('cancelDrillButton');
    const submitButton = document.getElementById('submitDrillButton');
    const timerButton = document.getElementById('timerButton');
    const recordSpeedButton = document.getElementById('recordSpeedButton');
    const stopSpeedButton = document.getElementById('stopSpeedButton');
    const speedControls = document.getElementById('speedControls');
    const responseBox = document.getElementById('drillResponse');
    const titleEl = document.getElementById('drillTitle');
    const topicEl = document.getElementById('drillTopic');
    const promptEl = document.getElementById('drillPrompt');
    const taskEl = document.getElementById('drillTask');
    const timerEl = document.getElementById('drillTimer');
    const timerInput = document.getElementById('drillTimerInput');
    const feedbackEl = document.getElementById('drillFeedback');
    const responseModeLabel = document.getElementById('responseModeLabel');

    let currentType = null;
    let currentDrill = null;
    let timerInterval = null;
    let remainingSeconds = 0;
    let mediaRecorder = null;
    let audioChunks = [];

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
        return Math.min(Math.max((minutes * 60) + seconds, 10), 600);
    }

    function setLoading(message) {
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
        timerEl.textContent = formatTime(remainingSeconds);
        timerInput.disabled = Boolean(currentDrill);
        timerButton.disabled = !currentDrill;
        timerButton.textContent = 'Start Timer';
    }

    function setIdleState(message = 'Select a drill to start.') {
        currentDrill = null;
        clearInterval(timerInterval);
        timerInterval = null;
        remainingSeconds = 0;
        titleEl.textContent = 'Select a Drill';
        topicEl.textContent = message;
        promptEl.textContent = '';
        taskEl.textContent = '';
        timerEl.textContent = '--:--';
        timerInput.disabled = false;
        timerEl.textContent = timerInput.value || '01:00';
        responseBox.value = '';
        responseBox.disabled = true;
        submitButton.disabled = true;
        timerButton.disabled = true;
        recordSpeedButton.disabled = true;
        stopSpeedButton.disabled = true;
        startDrillButton.disabled = !currentType;
        cancelDrillButton.disabled = true;
        feedbackEl.classList.add('empty-state');
        feedbackEl.textContent = 'Complete a drill to see feedback here.';
        renderMode();
    }

    function startTimer() {
        if (!currentDrill || timerInterval) {
            return;
        }

        timerButton.textContent = 'Timer Running';
        timerInterval = setInterval(() => {
            remainingSeconds -= 1;
            timerEl.textContent = formatTime(Math.max(remainingSeconds, 0));
            if (remainingSeconds <= 0) {
                clearInterval(timerInterval);
                timerInterval = null;
                timerButton.textContent = 'Restart Timer';
            }
        }, 1000);
    }

    function setDrillType(type) {
        currentType = type;
        typeButtons.forEach((button) => {
            button.classList.toggle('active', button.dataset.drillType === type);
        });
        setIdleState('Press Start Drill when you are ready.');
    }

    function renderMode() {
        const isSpeed = currentType === 'speed';
        speedControls.hidden = !isSpeed;
        responseBox.hidden = isSpeed;
        submitButton.hidden = isSpeed;
        if (!currentDrill) {
            responseBox.disabled = true;
        }
        responseModeLabel.textContent = isSpeed
            ? 'Record yourself reading the passage.'
            : currentType
                ? 'Type your answer, then submit.'
                : 'Choose a drill, then press Start Drill.';
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
        startDrillButton.disabled = true;
        cancelDrillButton.disabled = false;
        submitButton.disabled = true;
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
                body: JSON.stringify({ drill_type: currentType })
            });

            currentDrill = data.drill;
            titleEl.textContent = currentDrill.title || 'Drill';
            topicEl.textContent = currentDrill.topic || '';
            promptEl.textContent = currentDrill.prompt || '';
            taskEl.textContent = currentDrill.task || '';
            resetTimer(parseTime(timerInput.value));
            submitButton.disabled = currentType === 'speed';
            recordSpeedButton.disabled = currentType !== 'speed';
            responseBox.disabled = currentType === 'speed';
            startDrillButton.disabled = false;
            cancelDrillButton.disabled = false;
            feedbackEl.classList.add('empty-state');
            feedbackEl.textContent = currentType === 'speed'
                ? 'Start recording when you are ready. Speak fast, but keep it clear.'
                : 'Complete a drill to see feedback here.';
            if (currentType !== 'speed') {
                startTimer();
            }
        } catch (error) {
            showError(error.message);
            titleEl.textContent = 'Could not load drill';
            startDrillButton.disabled = false;
        }
    }

    function renderTypedFeedback(feedback) {
        const strengths = (feedback.strengths || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
        const improvements = (feedback.improvements || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
        feedbackEl.classList.remove('empty-state');
        feedbackEl.innerHTML = `
            <div class="feedback-score">Score: ${escapeHtml(feedback.score)}/10</div>
            <h3>${escapeHtml(feedback.headline)}</h3>
            <strong>What worked</strong>
            <ul>${strengths || '<li>Keep building specificity.</li>'}</ul>
            <strong>Next reps</strong>
            <ul>${improvements || '<li>Make the response more complete.</li>'}</ul>
            ${feedback.model_answer ? `<strong>Model answer</strong><p>${escapeHtml(feedback.model_answer)}</p>` : ''}
        `;
    }

    function renderSpeedFeedback(feedback) {
        feedbackEl.classList.remove('empty-state');
        feedbackEl.innerHTML = `
            <div class="feedback-score">${escapeHtml(feedback.wpm)} WPM</div>
            <h3>${escapeHtml(feedback.headline)}</h3>
            <p><strong>Accuracy:</strong> ${escapeHtml(feedback.accuracy)}%</p>
            <p><strong>Duration:</strong> ${escapeHtml(feedback.duration_seconds)}s</p>
            <p><strong>Recognized words:</strong> ${escapeHtml(feedback.word_count)}</p>
            <strong>Transcript</strong>
            <p>${escapeHtml(feedback.transcript)}</p>
        `;
    }

    async function submitTypedDrill() {
        if (!currentDrill) {
            return;
        }

        const response = responseBox.value.trim();
        if (!response) {
            showError('Write a response before submitting.');
            return;
        }

        submitButton.disabled = true;
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
            submitButton.disabled = false;
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
            recordSpeedButton.disabled = true;
            stopSpeedButton.disabled = false;
            setLoading('Recording...');
            startTimer();
        } catch (error) {
            showError('Could not start recording. Check microphone permissions.');
        }
    }

    async function stopSpeedRecording() {
        if (!mediaRecorder) {
            return;
        }

        stopSpeedButton.disabled = true;
        mediaRecorder.onstop = async () => {
            mediaRecorder.stream.getTracks().forEach((track) => track.stop());
            const recordedBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const formData = new FormData();
            formData.append('audio', recordedBlob, 'drill_speed.webm');
            formData.append('passage', currentDrill.prompt || '');
            setLoading('Transcribing and scoring...');

            try {
                const response = await fetch('/api/score-speed-drill', {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' },
                    body: formData
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.error || 'Could not score the recording.');
                }
                renderSpeedFeedback(data.feedback);
            } catch (error) {
                showError(error.message);
            } finally {
                recordSpeedButton.disabled = false;
                audioChunks = [];
            }
        };
        mediaRecorder.stop();
    }

    typeButtons.forEach((button) => {
        button.addEventListener('click', () => setDrillType(button.dataset.drillType));
    });
    startDrillButton.addEventListener('click', () => {
        if (!currentType) {
            setIdleState();
            return;
        }
        generateDrill();
    });
    cancelDrillButton.addEventListener('click', () => setIdleState('Press Start Drill when you are ready.'));
    submitButton.addEventListener('click', submitTypedDrill);
    timerButton.addEventListener('click', () => {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
            resetTimer(currentDrill?.timer_seconds || 60);
        } else {
            startTimer();
        }
    });
    recordSpeedButton.addEventListener('click', startSpeedRecording);
    stopSpeedButton.addEventListener('click', stopSpeedRecording);
    timerInput.addEventListener('input', () => {
        if (!currentDrill) {
            timerEl.textContent = formatTime(parseTime(timerInput.value));
        }
    });

    setIdleState();
});
