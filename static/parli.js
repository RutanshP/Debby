document.addEventListener('DOMContentLoaded', function() {
    const submitButton = document.getElementById('submit-topic');
    const topicInput = document.getElementById('custom-topic');
    const sideSelect = document.getElementById('side');
    const formatSelect = document.getElementById('format');
    const caseOutput = document.getElementById('case-output');

    function showLoading() {
        caseOutput.innerHTML = '<img src="static/loading.gif" alt="Loading..." style="width: 2em; height: 2em;">';
    }

    function hideLoading() {
        setInitialPlaceholder(caseOutput, "Debate Case");
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

    function updateSubmitButtonState() {
        const topic = topicInput.value.trim();
        const format = formatSelect.value;
        if (topic && format) {
            submitButton.disabled = false;
        } else {
            submitButton.disabled = true;
        }
    }

    // Add event listeners to inputs to update submit button state
    topicInput.addEventListener('input', updateSubmitButtonState);
    formatSelect.addEventListener('change', updateSubmitButtonState);

    submitButton.addEventListener('click', function() {
        const topic = topicInput.value.trim();
        const side = sideSelect.value;
        const format = formatSelect.value;

        if (topic === '') {
            alert('Please enter a topic.');
            return;
        }

        if (format === '') {
            alert('Please select a debate format.');
            return;
        }

        const url = `/generate-case?topic=${encodeURIComponent(topic)}&side=${encodeURIComponent(side)}&format=${encodeURIComponent(format)}`;
        showLoading();

        fetch(url)
            .then(response => response.json())
            .then(data => {
                hideLoading();
                if (data.error) {
                    alert(data.error);
                } else {
                    const markdownContent = data.case;
                    const htmlContent = marked.parse(markdownContent);
                    caseOutput.innerHTML = htmlContent;
                }
            })
            .catch(error => {
                hideLoading();
                console.error('Error:', error);
                alert('An error occurred while generating the debate case.');
            });
    });
    updateSubmitButtonState();
});
