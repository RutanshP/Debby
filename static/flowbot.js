document.addEventListener("DOMContentLoaded", function () {
    const debateTypeSelect = document.getElementById("debateType");
    const submitButton = document.getElementById("submitTopic");
    const debateTopicDiv = document.getElementById("debateTopic");
    const speechSpeedSlider = document.getElementById("speechSpeed");
    const speedValueDiv = document.getElementById("speedValue");

    function linearToLog(value) {
        const minp = 0;
        const maxp = 100;
        const minv = Math.log(0.25);
        const maxv = Math.log(4);

        const scale = (maxv - minv) / (maxp - minp);
        return Math.exp(minv + scale * (value - minp));
    }

    function updateSpeedValue() {
        const speed = linearToLog(speechSpeedSlider.value).toFixed(2);
        speedValueDiv.textContent = `Speed: ${speed}x`;
    }

    debateTypeSelect.addEventListener("change", function () {
        const debateType = debateTypeSelect.value;
        submitButton.disabled = debateType === "";
    });

    submitButton.addEventListener("click", function () {
        const debateType = debateTypeSelect.value;
        const speechSpeed = linearToLog(speechSpeedSlider.value).toFixed(2);
        fetch(`/get-topic?debateType=${debateType}`)
            .then(response => response.json())
            .then(data => {
                let topic = data.topic;
            })
            .catch(error => console.error("Error fetching topic:", error));
        fetch(`/random-generate-case?format=${debateType}?speed=${speechSpeed}?format=${topic}`)
        .then(response => response.json())
            .then(data => {
                let the_case = data.case;
            })
            .catch(error => console.error("Error fetching case:", error));

        debateTopicDiv.innerText = marked.parse(the_case)
    });

    speechSpeedSlider.addEventListener("input", function () {
        updateSpeedValue();
        const speed = linearToLog(speechSpeedSlider.value).toFixed(2);
        console.log(`Speed: ${speed}`);
    });

    // Initial update of the speed value display
    updateSpeedValue();
});
