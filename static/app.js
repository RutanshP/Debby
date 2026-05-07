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
    const cancelRecordingButton = document.getElementById('cancelRecording');
    const statsContainer = document.getElementById('speechStats');
    const wpmPlotImg = document.getElementById('wpmPlot');
    const tournamentLabel = document.getElementById('tournamentLabel');
    const customTopicInput = document.getElementById('customTopic');
    const stepPills = Array.from(document.querySelectorAll('.practice-steps .step-pill'));

    let mediaRecorder;
    let audioChunks = [];
    let currentFetchController = null;
    let currentTopic = '';
    let firstTranscription = '';
    let secondTranscription = '';
    let currentAiSpeech = '';
    let currentWinner = '';

    function setActiveStep(stepName) {
        stepPills.forEach(pill => {
            pill.classList.toggle('active', pill.textContent.trim() === stepName);
        });
    }

    function setInitialPlaceholder(element, placeholder) {
        element.innerText = placeholder;
        element.classList.add('placeholder');
        element.style.color = '';
    }

    function clearPlaceholder(element, text) {
        element.classList.remove('placeholder');
        element.innerText = text;
        element.style.color = '';
    }

    function clearTopic() {
        clearPlaceholder(debateTopicDiv, 'Topic');
    }

    function hide_ai_loading() {
        setInitialPlaceholder(aiResponseDiv, "Debby's Response");
    }

    function hide_winner_loading() {
        setInitialPlaceholder(winnerDiv, 'Winner');
    }

    function clearCustomTopicInput() {
        customTopicInput.value = '';
        submitCustomTopicButton.disabled = true;
        submitCustomTopicButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
        customTopicInput.disabled = false; // Ensure input is enabled by default
    }

    function disableCustomTopicInput() {
        customTopicInput.disabled = true;
    }

    function enableCustomTopicInput() {
        customTopicInput.disabled = false;
    }

    function disableDebateTypeSelect() {
        debateTypeSelect.disabled = true;
        debateTypeSelect.style.backgroundColor = '#d4e5d3'; // Light green when disabled
    }

    function enableDebateTypeSelect() {
        debateTypeSelect.disabled = false;
        debateTypeSelect.style.backgroundColor = ''; // Reset to default
    }

    function disableTournamentSelect() {
        tournamentSelect.disabled = true;
        tournamentSelect.style.backgroundColor = '#d4e5d3'; // Light green when disabled
    }

    function enableTournamentSelect() {
        tournamentSelect.disabled = false;
        tournamentSelect.style.backgroundColor = ''; // Reset to default
    }

    function resetForm() {
        debateTypeSelect.value = '';
        tournamentSelect.value = '';
        tournamentSelect.style.display = 'none';
        tournamentLabel.style.display = 'none';
        clearTopic();
        setInitialPlaceholder(aiResponseDiv, 'Debby\'s Response');
        setInitialPlaceholder(winnerDiv, 'Winner');
        setActiveStep('Topic');
        clearCustomTopicInput();
        updateButtonsState();
        
        if (currentFetchController) {
            currentFetchController.abort();
            currentFetchController = null;
        }
    
        // Reset the timer and related displays to "02:00"
        const defaultTime = "02:00";
        document.getElementById('timer').textContent = defaultTime;
        document.getElementById('customTime').value = defaultTime;
        updateTimerDisplay(defaultTime);
        updateMaxTimeDisplay(defaultTime);
        
        audioChunks = [];
        fetchTopicButton.disabled = true; // Ensure fetchTopicButton is disabled
        fetchTopicButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
    }
    
    function updateTimerDisplay(time) {
        document.getElementById('timer').textContent = time;
    }
    
    function updateMaxTimeDisplay(time) {
        document.getElementById('maxTimeDisplay').textContent = time;
    }
    

    function updateFetchTopicButtonState() {
        fetchTopicButton.disabled = debateTypeSelect.value === '' || (debateTypeSelect.value === 'Parli' && tournamentSelect.value === '');
        fetchTopicButton.style.backgroundColor = fetchTopicButton.disabled ? '#d4e5d3' : '#00796b'; // Light green if disabled
    }

    function updateButtonsState() {
        const topicPresent = debateTopicDiv.innerText && debateTopicDiv.innerText !== 'Topic';
        startRecordingButton.disabled = !topicPresent;
        startRecordingButton.style.backgroundColor = startRecordingButton.disabled ? '#d4e5d3' : '#00796b'; // Light green if disabled
        stopRecordingButton.disabled = true; // Initially disabled
        stopRecordingButton.style.backgroundColor = stopRecordingButton.disabled ? '#d4e5d3' : '#00796b'; // Light green if disabled
        refreshButton.disabled = false; // Assuming refresh button is always enabled
        refreshButton.style.backgroundColor = refreshButton.disabled ? '#d4e5d3' : '#00796b'; // Dark blue when enabled
        submitCustomTopicButton.disabled = customTopicInput.value.trim() === '';
        submitCustomTopicButton.style.backgroundColor = submitCustomTopicButton.disabled ? '#d4e5d3' : '#00796b'; // Light green if disabled
    }


    function disableAllControlsExceptStopRecording() {
        fetchTopicButton.disabled = true;
        startRecordingButton.disabled = true;
        submitCustomTopicButton.disabled = true;
        refreshButton.disabled = true;
        viewEntriesButton.disabled = true; // Disable View Entries button
        fetchTopicButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
        startRecordingButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
        submitCustomTopicButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
        refreshButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
        viewEntriesButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
        stopRecordingButton.disabled = false; // Ensure stop button is enabled
        stopRecordingButton.style.backgroundColor = '#00796b'; // Dark blue when enabled
        disableTournamentSelect();
        disableDebateTypeSelect();
        disableCustomTopicInput();


    }
    
    function enableAllControls() {
        fetchTopicButton.disabled = debateTypeSelect.value === '' || (debateTypeSelect.value === 'Parli' && tournamentSelect.value === '');
        fetchTopicButton.style.backgroundColor = fetchTopicButton.disabled ? '#d4e5d3' : '#00796b'; // Light green if disabled
        startRecordingButton.disabled = false;
        startRecordingButton.style.backgroundColor = '#00796b'; // Green when enabled
        submitCustomTopicButton.disabled = customTopicInput.value.trim() === '';
        submitCustomTopicButton.style.backgroundColor = submitCustomTopicButton.disabled ? '#d4e5d3' : '#00796b'; // Light green if disabled
        refreshButton.disabled = false;
        refreshButton.style.backgroundColor = refreshButton.disabled ? '#d4e5d3' : '#00796b'; // Dark blue when enabled
        viewEntriesButton.disabled = false; // Enable View Entries button
        viewEntriesButton.style.backgroundColor = '#00796b'; // Green when enabled
        updateButtonsState(); // Ensure styles are updated
        updateFetchTopicButtonState(); // Ensure FetchTopic button state is updated
        enableCustomTopicInput(); // Re-enable custom topic input
        enableDebateTypeSelect(); // Re-enable debate type select
        enableTournamentSelect(); // Re-enable tournament select
    }
    

    function ai_loading() {
        aiResponseDiv.innerHTML = '<img src="static/loading.gif" alt="Loading..." style="width: 2em; height: 2em;">';
    }
    
    function winner_loading() {
        winnerDiv.innerHTML = '<img src="static/loading.gif" alt="Loading..." style="width: 2em; height: 2em;">';
    }

    setInitialPlaceholder(debateTopicDiv, 'Topic');
    setInitialPlaceholder(aiResponseDiv, 'Debby\'s Response');
    setInitialPlaceholder(winnerDiv, 'Winner');
    setActiveStep('Topic');

    customTopicInput.addEventListener('input', () => {
        submitCustomTopicButton.disabled = customTopicInput.value.trim() === '';
        submitCustomTopicButton.style.backgroundColor = submitCustomTopicButton.disabled ? '#d4e5d3' : '#00796b'; // Light green if disabled
    });

    debateTypeSelect.addEventListener('change', () => {
        if (debateTypeSelect.value === 'Parli') {
            tournamentSelect.style.display = 'block';
            tournamentLabel.style.display = 'block';
        } else {
            tournamentSelect.style.display = 'none';
            tournamentLabel.style.display = 'none';
        }
        clearTopic();
        clearCustomTopicInput();
        updateFetchTopicButtonState();
        updateButtonsState();
    });

    tournamentSelect.addEventListener('change', () => {
        clearTopic();
        clearCustomTopicInput();
        updateFetchTopicButtonState();
    });

    fetchTopicButton.addEventListener('click', async () => {
        if (currentFetchController) {
            currentFetchController.abort();
        }
        currentFetchController = new AbortController();
        const { signal } = currentFetchController;
        const debateType = debateTypeSelect.value;
        const tournament = debateType === 'Parli' ? tournamentSelect.value : '';

        try {
            const response = await fetch(`/get-topic?debateType=${encodeURIComponent(debateType)}&tournament=${encodeURIComponent(tournament)}`, { signal });
            const data = await response.json();
            currentTopic = data.topic;
            clearPlaceholder(debateTopicDiv, `Debate Topic: ${currentTopic}`);
            setActiveStep('Topic');
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Fetch error:', error);
            }
        } finally {
            clearCustomTopicInput();
            currentFetchController = null;
            updateButtonsState();
        }
    });

    submitCustomTopicButton.addEventListener('click', async () => {
        const customTopic = customTopicInput.value.trim();
        if (customTopic) {
            if (currentFetchController) {
                currentFetchController.abort();
            }
            currentFetchController = new AbortController();
            const { signal } = currentFetchController;

            try {
                const response = await fetch(`/get-topic?customTopic=${encodeURIComponent(customTopic)}`, { signal });
                const data = await response.json();
                currentTopic = data.topic;
                clearPlaceholder(debateTopicDiv, `Debate Topic: ${currentTopic}`);
                setActiveStep('Topic');
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Fetch error:', error);
                }
            } finally {
                currentFetchController = null;
                updateButtonsState();
            }
        }
    });

    let recordingState = 0; // 0: idle, 1: first speech, 2: second speech
    let countdown;
    
    // Start Recording Button
    startRecordingButton.addEventListener('click', async () => {
        console.log('Start Recording button clicked.');
    
        if (startRecordingButton.innerText === 'Start Recording' || startRecordingButton.innerText === 'Rebuttal Speech') {
            if (recordingState === 0) {
                console.log('Starting first speech recording.');
                // Start recording the first speech
                disableAllControlsExceptStopRecording();
                audioChunks = []; // Reset audio chunks for the first speech
                await startRecording();
                setActiveStep('Constructive');
                setInitialPlaceholder(aiResponseDiv, 'Debby\'s Response');
                setInitialPlaceholder(winnerDiv, 'Winner');
                recordingState = 1; // Transition to first speech recording
            } 
            else if (recordingState === 1) {
                console.log('Attempt to start recording while waiting for AI response.');
                // Waiting for AI response
                alert('Debby\'s response in progress, please wait.');
            } 
            else if (recordingState === 2) {
                console.log('Starting second speech recording.');
                // Start recording the second speech
                disableAllControlsExceptStopRecording();
                audioChunks = []; // Reset audio chunks for the second speech
                startRecording();
                setActiveStep('Rebuttal');
                setInitialPlaceholder(winnerDiv, 'Winner');
                recordingState = 2; // Transition to second speech recording
            }
        } else {
            console.log('Cancel Recording button clicked.');
            // Stop recording and handle the end of the recording
            cancelRecording();
            clearInterval(countdown);
            recordingState = 0; // Reset to idle state
        }
    });
    
    // Stop Recording Button
    stopRecordingButton.addEventListener('click', async () => {  // Mark the callback as async
        console.log('Stop Recording button clicked.');
        clearInterval(countdown);
        startRecordingButton.innerText = 'Start Recording';
        stopRecordingButton.disabled = true;
        stopRecordingButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
        startRecordingButton.disabled = true; // Disable button while waiting for AI response
        startRecordingButton.style.backgroundColor = '#d4e5d3';

        if (recordingState === 1) {
            setActiveStep('Response');
            ai_loading();
            const result = await stopRecording();  // Wait for stopRecording to complete
            console.log('Handling end of first speech recording.');
            handleFirstSpeechEnd(result);  // Handle end of the first speech
        } 
        else if (recordingState === 2) {
            setActiveStep('Decision');
            winner_loading();
            const result = await stopRecording();  // Wait for stopRecording to complete
            console.log('Handling end of second speech recording.');
            handleSecondSpeechEnd(result);  // Handle end of the second speech
        }
    });
    
    
    function handleFirstSpeechEnd(result) {
        console.log('First speech recording ended.');
        stopRecordingButton.disabled = true;
        stopRecordingButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
        startRecordingButton.disabled = true; // Disable button while waiting for AI response
        if (!result) {
            hide_ai_loading();
            return;
        }
        recordingState = 2;
        hide_ai_loading();
        firstTranscription = result.first_speech_transcription || '';
        currentAiSpeech = result.aiSpeech || '';
        clearPlaceholder(aiResponseDiv, `Debby’s Response: ${currentAiSpeech}`);
        setActiveStep('Rebuttal');
        startRecordingButton.style.backgroundColor = '#00796b';
        startRecordingButton.disabled = false;
        startRecordingButton.innerText = "Rebuttal Speech";
        recordingState = 2; // Transition to waiting for second speech
    }
    
    async function handleSecondSpeechEnd(result) {
        console.log('Second speech recording ended.');
        
        stopRecordingButton.disabled = true;
        stopRecordingButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
    
        recordingState = 0; // Reset to idle state
        hide_winner_loading();
        if (!result) {
            enableAllControls();
            return;
        }

        secondTranscription = result.second_speech_transcription || '';
        currentWinner = result.winner || result.result || '';
        console.log("Current winner:", currentWinner);
        const winnerElement = document.getElementById('winner');
        winnerElement.textContent = `Winner: ${currentWinner}`;
        setActiveStep('Decision');
        await logEntry();  // Check if it reaches this point
        enableAllControls();  // Re-enable controls
        
    }
    
    // Function to send recording to server
   

async function displaySpeechStatistics() {
    // Fetch and display speech statistics like WPM, word count
    const statsResponse = await fetch('/speech-statistics');
    if (statsResponse.ok) {
        const stats = await statsResponse.json();
        statsContainer.style.display = 'block';
        statsContainer.innerHTML = `
            <p><strong>First Speech:</strong> ${stats.first_speech_wpm} WPM (${stats.first_speech_word_count} words)</p>
            <p><strong>Second Speech:</strong> ${stats.second_speech_wpm} WPM (${stats.second_speech_word_count} words)</p>
            <p><strong>Average:</strong> ${stats.average_wpm} WPM</p>
        `;
    } else {
        console.error('Failed to fetch speech statistics.');
    }

    // Fetch and display WPM plot
    const plotResponse = await fetch('/wpm-plot');
    if (plotResponse.ok) {
        const plotBlob = await plotResponse.blob();
        const plotUrl = URL.createObjectURL(plotBlob);
        const wpmPlotImg = document.getElementById('wpmPlot');
        wpmPlotImg.src = plotUrl;
        wpmPlotImg.style.display = 'block';
    } else {
        console.error('Failed to fetch WPM plot.');
    }
}

async function fetchWinner() {
    try {
        const response = await fetch('/get-winner');
        const data = await response.json();

        if (data.error) {
            console.error(data.error);  // Log the error
        } else {
            console.log('Winner:', data.winner);  // Log the winner to the console

            // Update the DOM to display the winner
            hide_winner_loading();
            const winnerElement = document.getElementById('winner');
            winnerElement.textContent = `Winner: ${data.winner}`;
            setActiveStep('Decision');
        }
    } catch (error) {
        console.error('Error fetching winner:', error);
    }
}


    refreshButton.addEventListener('click', () => {
        resetForm();
        fetchTopicButton.disabled = true;
        fetchTopicButton.style.backgroundColor = '#d4e5d3'; // Light green when disabled
        
        // Hide the WPM plot and speech statistics
        wpmPlotImg.style.display = 'none';
    
        statsContainer.style.display = 'none';
    });
    

    async function fetchAiResponse() {
        try {
            const response = await fetch('/get-ai-speech');
            const data = await response.json();
            recordingState = 2
            hide_ai_loading();
            firstTranscription = data.first_speech_transcription;
            currentAiSpeech = data.aiSpeech;
            setActiveStep('Rebuttal');
            clearPlaceholder(aiResponseDiv, `Debby’s Response: ${currentAiSpeech}`);
            startRecordingButton.style.backgroundColor = '#00796b'; // Dark blue when recording
            startRecordingButton.disabled = false;
            startRecordingButton.innerText = "Rebuttal Speech";
            
        } catch (error) {
            console.error('Error fetching AI response:', error);
        }
    }


    async function logEntry() {
        function localDateTimeString(date) {
            const pad = value => String(value).padStart(2, '0');
            return [
                date.getFullYear(),
                pad(date.getMonth() + 1),
                pad(date.getDate())
            ].join('-') + ' ' + [
                pad(date.getHours()),
                pad(date.getMinutes()),
                pad(date.getSeconds())
            ].join(':');
        }

        const logData = {
            user_name: 'local',
            date_time: localDateTimeString(new Date()),
            topic: currentTopic,
            aff_speech: firstTranscription,
            neg_speech: currentAiSpeech,
            aff_two_speech: secondTranscription,
            winner: currentWinner
        };

        try {
            const response = await fetch('/log_entry', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(logData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Log entry successful:', result.message);
            } else {
                console.error('Failed to log entry');
            }
        } catch (error) {
            console.error('Error logging entry:', error);
        }
    }

    async function startRecording() {
        audioChunks = [];
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? { mimeType: 'audio/webm;codecs=opus' }
                    : {};
                mediaRecorder = new MediaRecorder(stream, options);
                mediaRecorder.ondataavailable = event => {
                    if (event.data.size > 0) {
                        audioChunks.push(event.data);
                    }
                };
                mediaRecorder.start();
                startRecordingButton.innerText = 'Cancel Recording';
                startRecordingButton.style.backgroundColor = '#00796b'; // Dark blue when recording
                startRecordingButton.disabled = false;
            })
            .catch(error => {
                console.error('Error starting recording:', error);
            });
    }
    async function stopRecording() {
        return new Promise(async (resolve) => {
            if (mediaRecorder) {
                mediaRecorder.onstop = async () => {
                    console.log('Media recorder stopped.');
    
                    const recordedBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                    const formData = new FormData();
    
                    // Determine the speech type based on the recording state
                    let speechType = (recordingState === 1) ? 'first' : 'second';
    
                    // Append audio file and speech type to form data
                    formData.append('audio', recordedBlob, `${speechType}_speech.webm`);
                    formData.append('speech_type', speechType);
    
                    try {
                        console.log(`Sending ${speechType} speech recording to server.`);
    
                        const response = await fetch('/process-recording', {
                            method: 'POST',
                            body: formData
                        });
    
                        if (response.ok) {
                            console.log(`${speechType} speech recording successfully sent to the server.`);
                            const result = await response.json();
                            
                            // After successfully submitting the first speech, update the state for the second one
                            if (recordingState === 1) {
                                recordingState = 2;  // Move to the second speech
                            }
                            
                            await displaySpeechStatistics(); // Update the UI after submission
                            resolve(result);
                        } 
                        else {
                            console.error(`Failed to send ${speechType} speech. Status:`, response.status);
                            const errorText = await response.text();
                            console.error('Server error response:', errorText);
                            alert('There was an issue submitting your recording. Please try again.');
                            resolve(null);
                        }
                    } catch (error) {
                        console.error(`Error submitting ${speechType} speech:`, error);
                        alert('An error occurred while submitting the recording. Please check your connection and try again.');
                        resolve(null);
                    }
    
                    // Reset audio chunks for the next recording
                    audioChunks = [];
                };
                mediaRecorder.stop();
                
                // Prevent multiple submissions by disabling the button during the process
                startRecordingButton.disabled = true;
            } else {
                console.warn('No mediaRecorder instance found.');
                resolve();
            }
        });
    }
    
    
    
    async function cancelRecording() {
        console.log("Recording was canceled");
        // Clear all active intervals
        for (let i = 0; i < 9999; i++) {
            window.clearInterval(i);
        }
    
        // Reset the timer display to "00:00"
        const maxTime = document.getElementById('maxTimeDisplay').textContent; // Get the max time value
        document.getElementById('customTime').value = maxTime; // Reset the dropdown value to maxTime
        updateTimerDisplay(maxTime); // Update the timer display to match the maxTime
        updateMaxTimeDisplay(maxTime); // Update the max time display to match the maxTime
        // Stop the media recorder if it's active
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            audioChunks = [];
        }
        
        // Reset the UI and enable controls
        startRecordingButton.innerText = 'Start Recording';
        enableAllControls();
    }
    
    
});
