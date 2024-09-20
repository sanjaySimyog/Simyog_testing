document.getElementById('uploadForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  let projectName = document.getElementById('projectName').value;
  let projectFile = document.getElementById('projectFile').files[0];

  let formData = new FormData();
  formData.append('projectName', projectName);
  formData.append('projectFile', projectFile);

  try {
    let response = await fetch('http://localhost:3000/upload', {
      method: 'POST',
      body: formData
    });

    let result = await response.json();
    if (result.success) {
      alert('Project uploaded successfully');
      fetchProjects(); // Refresh project list
    } else {
      alert('Failed to upload project');
    }
  } catch (err) {
    console.error('Error uploading project:', err);
  }
});

// Update fetchProjects to add download button for completed projects
async function fetchProjects() {
  try {
    let response = await fetch('http://localhost:3000/projects');
    let projects = await response.json();

    let tableBody = document.getElementById('projectTableBody');
    tableBody.innerHTML = '';

    projects.forEach((project) => {
      let row = document.createElement('tr');

      let nameCell = document.createElement('td');
      nameCell.textContent = project.name;
      row.appendChild(nameCell);

      let statusCell = document.createElement('td');
      statusCell.textContent = project.status;
      row.appendChild(statusCell);

      let actionCell = document.createElement('td');
      actionCell.classList.add('actions');

      // Add Start and Stop buttons only if the project is not completed
      if (project.status !== 'Completed') {
        let startButton = document.createElement('button');
        startButton.textContent = 'Start';
        startButton.onclick = () => manageProject(project.name, 'start');
        actionCell.appendChild(startButton);

        let stopButton = document.createElement('button');
        stopButton.textContent = 'Stop';
        stopButton.onclick = () => manageProject(project.name, 'stop');
        actionCell.appendChild(stopButton);
      } else {
        // Add Download button for completed projects
        let downloadButton = document.createElement('button');
        downloadButton.textContent = 'Download Output';
        downloadButton.onclick = () => downloadOutputFile(project.name);
        actionCell.appendChild(downloadButton);
      }

      let deleteButton = document.createElement('button');
      deleteButton.textContent = 'Delete';
      deleteButton.onclick = () => manageProject(project.name, 'delete');
      actionCell.appendChild(deleteButton);

      row.appendChild(actionCell);

      tableBody.appendChild(row);
    });
  } catch (err) {
    console.error('Error fetching projects:', err);
  }
}

// Function to download the output file
async function downloadOutputFile(projectName) {
  try {
    let response = await fetch(`http://localhost:3000/project/${projectName}/download`);
    let blob = await response.blob();
    let url = window.URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}_output.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.error('Error downloading output file:', err);
  }
}


async function manageProject(projectName, action) {
  try {
    let response = await fetch(`http://localhost:3000/project/${projectName}/${action}`, {
      method: 'POST'
    });

    let result = await response.json();
    if (result.success) {
      alert(`Project ${action}ed successfully`);
      fetchProjects(); // Refresh project list
    } else {
      alert(`Failed to ${action} project`);
    }
  } catch (err) {
    console.error(`Error managing project: ${err}`);
  }
}

// Fetch the projects list on page load
fetchProjects();
