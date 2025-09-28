document.addEventListener('DOMContentLoaded', () => {
    const tournamentSelect = document.getElementById('tournament');
    const debateTypeSelect = document.getElementById('debateType');
    const fetchTopicButton = document.getElementById('fetchTopic');
    const startRecordingButton = document.getElementById('startRecording');
    const stopRecordingButton = document.getElementById('stopRecording');
    const refreshButton = document.getElementById('refreshButton');
    const submitCustomTopicButton = document.getElementById('submitCustomTopic');
    const viewEntriesButton = document.getElementById('viewEntriesButton');
    const debateTopicDiv = document.getElementById('debateTopic');
    const aiResponseDiv = document.getElementById('aiResponse');
    const winnerDiv = document.getElementById('winner');
    const statsContainer = document.getElementById('speechStats');
    const wpmPlotImg = document.getElementById('wpmPlot');
    const tournamentLabel = document.getElementById('tournamentLabel');
    const customTopicInput = document.getElementById('customTopic');

    let mediaRecorder;
    let audioChunks = [];
    let currentFetchController = null;
    let currentTopic = '';
    let firstTranscription = '';
    let secondTranscription = '';
    let currentAiSpeech = '';
    let currentWinner = '';
    let recordingState = 0; // 0: idle, 1: first speech, 2: second speech
    let countdown;

    function setInitialPlaceholder(element, placeholder) {
        element.innerText = placeholder;
        element.classList.add('placeholder');
    }

    function clearPlaceholder(element, text) {
        element.classList.remove('placeholder');
        element.innerText = text;
    }

    function ai_loading() {
        aiResponseDiv.innerHTML = '<img src="static/loading.gif" alt="Loading..." style="width: 2em; height: 2em;">';
    }

    function winner_loading() {
        winnerDiv.innerHTML = '<img src="static/loading.gif" alt="Loading..." style="width: 2em; height: 2em;">';
    }

    function updateButtonsState() {
        const topicPresent = currentTopic !== '';
        startRecordingButton.disabled = !topicPresent;
        stopRecordingButton.disabled = true;
        submitCustomTopicButton.disabled = customTopicInput.value.trim() === '';
    }

    function disableAllControlsExceptStopRecording() {
        fetchTopicButton.disabled = true;
        startRecordingButton.disabled = true;
        submitCustomTopicButton.disabled = true;
        refreshButton.disabled = true;
        viewEntriesButton.disabled = true;
        debateTypeSelect.disabled = true;
        tournamentSelect.disabled = true;
        customTopicInput.disabled = true;
        stopRecordingButton.disabled = false;
    }

    function enableAllControls() {
        fetchTopicButton.disabled = false;
        startRecordingButton.disabled = false;
        submitCustomTopicButton.disabled = false;
        refreshButton.disabled = false;
        viewEntriesButton.disabled = false;
        debateTypeSelect.disabled = false;
        tournamentSelect.disabled = false;
        customTopicInput.disabled = false;
        updateButtonsState();
    }

    function resetUI() {
        setInitialPlaceholder(debateTopicDiv, 'Topic');
        setInitialPlaceholder(aiResponseDiv, 'Debby\'s Response');
        setInitialPlaceholder(winnerDiv, 'Winner');
        wpmPlotImg.style.display = 'none';
        statsContainer.style.display = 'none';
        startRecordingButton.innerText = 'Start Recording';
        enableAllControls();
    }

    function resetState() {
        currentTopic = '';
        firstTranscription = '';
        secondTranscription = '';
        currentAiSpeech = '';
        currentWinner = '';
        recordingState = 0;
        audioChunks = [];
    }

    async function fetchAndDisplayStats(audioBlob, transcription) {
        const statsFormData = new FormData();
        statsFormData.append('audio', audioBlob, 'speech.m4a');
        statsFormData.append('transcript', transcription);

        const plotFormData = new FormData();
        plotFormData.append('audio', audioBlob, 'speech.m4a');

        const [statsResponse, plotResponse] = await Promise.all([
            fetch('/speech-statistics', { method: 'POST', body: statsFormData }),
            fetch('/wpm-plot', { method: 'POST', body: plotFormData })
        ]);

        if (statsResponse.ok) {
            const stats = await statsResponse.json();
            statsContainer.innerHTML = `
                <p><strong>Average WPM:</strong> ${stats.average_wpm.toFixed(2)}</p>
                <p><strong>Word Count:</strong> ${stats.word_count}</p>
            `;
            statsContainer.style.display = 'block';
        }

        if (plotResponse.ok) {
            const plotBlob = await plotResponse.blob();
            wpmPlotImg.src = URL.createObjectURL(plotBlob);
            wpmPlotImg.style.display = 'block';
        }
    }

    async function logEntry() {
        const logData = {
            user_name: 'local',
            date_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
            topic: currentTopic,
            aff_speech: firstTranscription,
            neg_speech: currentAiSpeech,
            aff_two_speech: secondTranscription,
            winner: currentWinner
        };

        await fetch('/log_entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(logData)
        });
    }

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            
            mediaRecorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/m4a' });
                const formData = new FormData();
                formData.append('audio', audioBlob, 'recording.m4a');
                formData.append('topic', currentTopic);

                if (recordingState === 1) { // End of first speech
                    ai_loading();
                    formData.append('speech_type', 'first');
                    
                    const response = await fetch('/process-recording', { method: 'POST', body: formData });
                    const data = await response.json();

                    if (data.error) {
                        console.error(data.error);
                        resetUI();
                        resetState();
                        return;
                    }

                    firstTranscription = data.first_speech_transcription;
                    currentAiSpeech = data.aiSpeech;
                    
                    clearPlaceholder(aiResponseDiv, `Debby’s Response: ${currentAiSpeech}`);
                    await fetchAndDisplayStats(audioBlob, firstTranscription);

                    recordingState = 2;
                    startRecordingButton.innerText = 'Rebuttal Speech';
                    enableAllControls();

                } else if (recordingState === 2) { // End of second speech
                    winner_loading();
                    formData.append('speech_type', 'second');
                    formData.append('first_speech_transcription', firstTranscription);
                    formData.append('ai_speech', currentAiSpeech);

                    const response = await fetch('/process-recording', { method: 'POST', body: formData });
                    const data = await response.json();

                    if (data.error) {
                        console.error(data.error);
                        resetUI();
                        resetState();
                        return;
                    }

                    secondTranscription = data.second_speech_transcription;
                    currentWinner = data.result;

                    clearPlaceholder(winnerDiv, `Winner: ${currentWinner}`);
                    await fetchAndDisplayStats(audioBlob, secondTranscription);
                    await logEntry();

                    resetState();
                    enableAllControls();
                }
            };

            audioChunks = [];
            mediaRecorder.start();

            disableAllControlsExceptStopRecording();
            startRecordingButton.innerText = 'Cancel Recording';

            const timeStr = document.getElementById('customTime').value;
            let time = timeStr.split(':').reduce((acc, val) => acc * 60 + +val, 0);
            countdown = setInterval(() => {
                time--;
                if (time <= 0) {
                    clearInterval(countdown);
                    stopRecordingButton.click();
                }
            }, 1000);

        } catch (error) {
            console.error('Error starting recording:', error);
            enableAllControls();
        }
    }

    async function stopRecording() {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
    }

    // Event Listeners
    fetchTopicButton.addEventListener('click', async () => {
        if (currentFetchController) currentFetchController.abort();
        currentFetchController = new AbortController();
        const { signal } = currentFetchController;
        const debateType = debateTypeSelect.value;
        const tournament = debateType === 'Parli' ? tournamentSelect.value : '';

        try {
            const response = await fetch(`/get-topic?debateType=${encodeURIComponent(debateType)}&tournament=${encodeURIComponent(tournament)}`, { signal });
            const data = await response.json();
            currentTopic = data.topic;
            clearPlaceholder(debateTopicDiv, `Debate Topic: ${currentTopic}`);
            updateButtonsState();
        } catch (error) {
            if (error.name !== 'AbortError') console.error('Fetch error:', error);
        } finally {
            currentFetchController = null;
        }
    });

    submitCustomTopicButton.addEventListener('click', async () => {
        const customTopic = customTopicInput.value.trim();
        if (customTopic) {
            currentTopic = customTopic;
            clearPlaceholder(debateTopicDiv, `Debate Topic: ${currentTopic}`);
            updateButtonsState();
        }
    });

    startRecordingButton.addEventListener('click', () => {
        if (recordingState === 0) {
            recordingState = 1;
            startRecording();
        } else if (recordingState === 2) {
            startRecording();
        } else { // Cancel
            if (mediaRecorder && mediaRecorder.state === "recording") {
                mediaRecorder.stop();
            }
            clearInterval(countdown);
            resetUI();
            resetState();
        }
    });

    stopRecordingButton.addEventListener('click', stopRecording);

    refreshButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
        clearInterval(countdown);
        resetUI();
        resetState();
    });

    debateTypeSelect.addEventListener('change', () => {
        tournamentSelect.style.display = debateTypeSelect.value === 'Parli' ? 'block' : 'none';
        tournamentLabel.style.display = debateTypeSelect.value === 'Parli' ? 'block' : 'none';
        updateButtonsState();
    });

    tournamentSelect.addEventListener('change', updateButtonsState);
    customTopicInput.addEventListener('input', updateButtonsState);

    // Initial setup
    resetUI();
    resetState();
});