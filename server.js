require('dotenv').config();
const express = require('express');  
const fileUpload = require('express-fileupload');  
const fs = require('fs');  
const cors = require('cors');  
const axios = require('axios');  // For persistent node communication  
 
const app = express();  
const port = 3000;  


const BUCKET_NAME = 'simyog-testing'; // Add your S3 bucket name here

// Enable CORS  
app.use(cors());  
 
const AWS = require('aws-sdk'); 

// Enable file upload middleware  
app.use(fileUpload());  
 
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();
const ec2 = new AWS.EC2();
const iam = new AWS.IAM();
const instanceTypes = {
  't2.micro': { vCPUs: 1, memoryGB: 1 },
  't2.small': { vCPUs: 1, memoryGB: 2 },
  't2.medium': { vCPUs: 2, memoryGB: 4 },
  't2.large': { vCPUs: 2, memoryGB: 8 },
  'm5.large': { vCPUs: 2, memoryGB: 8 },
  'm5.xlarge': { vCPUs: 4, memoryGB: 16 }
  // Add more instance types as needed
};

function analyzeProjectFile(projectFile) {
  // Analyze the file to determine requirements (e.g., parse metadata or content)
  // Here we simulate it with static values for demonstration
  const estimatedRequirements = {
    vCPUs: 2,  // Estimate based on the analysis
    memoryGB: 4 // Estimate based on the analysis
  };
  
  return estimatedRequirements;
}
function selectInstanceType(requirements) {
  let selectedType = 't2.micro'; // Default instance type
  
  for (const [type, specs] of Object.entries(instanceTypes)) {
    if (requirements.vCPUs <= specs.vCPUs && requirements.memoryGB <= specs.memoryGB) {
      selectedType = type;
      break;
    }
  }
  
  return selectedType;
}


// Step 1: Create the instance profile
async function createInstanceProfile() {
    try {
        const instanceProfile = await iam.createInstanceProfile({
            InstanceProfileName: 'EC2S3AccessInstanceProfile'  // You can choose a name here
        }).promise();
        
        console.log('Instance Profile Created:', instanceProfile);
        
        // Step 2: Add the role to the instance profile
        await iam.addRoleToInstanceProfile({
            InstanceProfileName: 'EC2S3AccessInstanceProfile',
            RoleName: 'EC2S3AccessRole'  // The role you already created
        }).promise();
        
        console.log('Role added to Instance Profile');
    } catch (error) {
        console.error('Error creating instance profile:', error);
    }
}

// Call this function before launching EC2 instances
createInstanceProfile();

async function uploadToS3(file, projectName) {
  const s3Key = `${projectName}/${file.name}`;  // Use this key format
  const params = {
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: file.data
  };
  
  try {
    const data = await s3.upload(params).promise();
    console.log(`File uploaded to S3: ${data.Location}`);
    return s3Key;  // Return only the S3 key (file path in the bucket)
  } catch (err) {
    console.error('Error uploading to S3:', err);
    throw err;
  }
}


// Store projects in-memory  
let projects = [];  

// Extract the folder path by removing the file name
var s3FolderUrl = NaN;

// API route to handle file upload
app.post('/upload', async (req, res) => {
    if (!req.files || !req.body.projectName) {
      return res.status(400).json({ success: false, message: 'Project name or file is missing' });
    }
  
    let projectName = req.body.projectName;
    let projectFile = req.files.projectFile;
  
    if (projects.some(project => project.name === projectName)) {
      return res.status(400).json({ success: false, message: 'Project already exists. Please use a different name.' });
    }
  
    try {
      // Upload the project file to S3
      const s3FileUrl = await uploadToS3(projectFile, projectName);
      console.log(`S3 File URL: ${s3FileUrl}`);
      s3FolderUrl = s3FileUrl.substring(0, s3FileUrl.lastIndexOf('/'));
      console.log(`S3 Folder URL: ${s3FolderUrl}`);
      // Add project to the in-memory list with S3 URL
      const newProject = {
        name: projectName,
        s3Url: s3FileUrl, // Store the S3 URL
        status: 'Pending', // Initial status
        timestamp: new Date()
      };
  
      projects.push(newProject);
  
      return res.json({ success: true, message: 'Project uploaded to S3 successfully', project: newProject });
    } catch (err) {
      console.error('Error uploading project:', err);
      return res.status(500).json({ success: false, message: 'Error uploading project' });
    }
});

// Function to start an EC2 instance
async function startEC2Instance(project) {
    // Analyze project to determine requirements
    const requirements = analyzeProjectFile(project.file);
  
    // Select instance type based on requirements
    const instanceType = selectInstanceType(requirements);

  
  const params = {
        ImageId: 'ami-0a5c3558529277641',
        InstanceType: instanceType,
        MinCount: 1,
        MaxCount: 1,
        KeyName: 'my-key-pair-simyog',
        SecurityGroupIds: ['sg-04d651065a8569ae2'],
        IamInstanceProfile: {
            Name: 'EC2S3AccessInstanceProfile'  // Replace with your IAM instance profile name
        },
        UserData: Buffer.from(`#!/bin/bash
          # User info
          whoami > /home/ec2-user/temp.txt
      
          # Update packages
          sudo yum update -y
      
          # Install AWS CLI
          sudo yum install -y aws-cli
      
          cd /home/ec2-user
      
          # Create a directory for the app
          mkdir myapp
      
          # Download the program from S3 using the correct bucket and key
          aws s3 cp s3://${BUCKET_NAME}/${project.s3Url} /home/ec2-user/myapp/simple_program.exe
      
          # Grant execution permissions
          chmod +x /home/ec2-user/myapp/simple_program.exe
      
          # Execute the program
          /home/ec2-user/myapp/simple_program.exe
      
          # Upload the output to the same S3 folder where the original file is stored
          sudo aws s3 cp /home/ec2-user/output.txt s3://${BUCKET_NAME}/${s3FolderUrl}/output.txt

          # Notify server about completion
          curl -X POST http://localhost:3000/project/${project.name}/complete
      `).toString('base64')      
    };

    try {
        const data = await ec2.runInstances(params).promise();
        const instanceId = data.Instances[0].InstanceId;
        console.log(`EC2 instance started with ID: ${instanceId}`);
        return instanceId;
    } catch (err) {
        console.error('Error starting EC2 instance:', err);
        throw err;
    }
}

// Function to stop an EC2 instance
async function stopEC2Instance(instanceId) {
    const params = {
      InstanceIds: [instanceId]
    };
  
    try {
      await ec2.stopInstances(params).promise();
      console.log(`EC2 instance stopped with ID: ${instanceId}`);
    } catch (err) {
      console.error('Error stopping EC2 instance:', err);
      throw err;
    }
}
  
// Function to terminate an EC2 instance
async function terminateEC2Instance(instanceId) {
    const params = {
      InstanceIds: [instanceId]
    };
  
    try {
      await ec2.terminateInstances(params).promise();
      console.log(`EC2 instance terminated with ID: ${instanceId}`);
    } catch (err) {
      console.error('Error terminating EC2 instance:', err);
      throw err;
    }
}

// API route to get list of projects  
app.get('/projects', (req, res) => {  
  res.json(projects);  
});

// API route to start a project  
app.post('/project/:projectName/start', async (req, res) => {  
  const projectName = req.params.projectName;  
  const project = projects.find(project => project.name === projectName);  
  
  if (!project) {  
   return res.status(404).json({ success: false, message: 'Project not found' });  
  }  
  
  try {  
   // Update project status to 'Running'  
   project.status = 'Running';  
   const instanceId = await startEC2Instance(project); // Pass the project to startEC2Instance
   project.instanceId = instanceId;
  
   return res.json({ success: true, message: 'Project started successfully' });  
  } catch (err) {  
   console.error('Error starting project:', err);  
   return res.status(500).json({ success: false, message: 'Error starting project' });  
  }  
});  

// API route to stop a project  
app.post('/project/:projectName/stop', async (req, res) => {  
  const projectName = req.params.projectName;  
  const project = projects.find(project => project.name === projectName);  
  
  if (!project) {  
   return res.status(404).json({ success: false, message: 'Project not found' });  
  }  
  
  try {  
   // Update project status to 'Stopped'  
   project.status = 'Stopped';  
   await stopEC2Instance(project.instanceId);
   return res.json({ success: true, message: 'Project stopped successfully' });  
  } catch (err) {  
   console.error('Error stopping project:', err);  
   return res.status(500).json({ success: false, message: 'Error stopping project' });  
  }  
});  

// API route to delete a project  
app.post('/project/:projectName/delete', async (req, res) => {  
  const projectName = req.params.projectName;  
  const project = projects.find(project => project.name === projectName);  
  
  if (!project) {  
   return res.status(404).json({ success: false, message: 'Project not found' });  
  }  
  
  try {  
   // Remove project from in-memory list  
   projects = projects.filter(project => project.name !== projectName);  
 
    if (project.instanceId) {
        await terminateEC2Instance(project.instanceId);
    }

   // Delete project file from uploads directory  
   await fs.promises.unlink(project.filePath);  
  
   return res.json({ success: true, message: 'Project deleted successfully' });  
  } catch (err) {  
   console.error('Error deleting project:', err);  
   return res.status(500).json({ success: false, message: 'Error deleting project' });  
  }  
});  

// API route to mark project as completed
app.post('/project/:projectName/complete', (req, res) => {
    const projectName = req.params.projectName;
    const project = projects.find(project => project.name === projectName);
  
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
  
    // Update project status to 'Completed'
    project.status = 'Completed';
  
    return res.json({ success: true, message: 'Project marked as completed' });
  });

// API route to download project output file
app.get('/project/:projectName/download', async (req, res) => {
    const projectName = req.params.projectName;
    const project = projects.find(project => project.name === projectName);
  
    if (!project || project.status !== 'Completed') {
      return res.status(404).json({ success: false, message: 'Project not found or not completed' });
    }
  
    const outputFileKey = `${project.name}/output.txt`;
    const params = {
      Bucket: BUCKET_NAME,
      Key: outputFileKey
    };
  
    try {
      const data = await s3.getObject(params).promise();
      res.setHeader('Content-Disposition', `attachment; filename=${projectName}_output.txt`);
      res.send(data.Body);
    } catch (err) {
      console.error('Error downloading file from S3:', err);
      res.status(500).json({ success: false, message: 'Error downloading output file' });
    }
  });
    

// Start the server  
app.listen(port, () => {  
  console.log(`Server running on port ${port}`);  
});  
