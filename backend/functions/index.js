const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});


if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// Firebase Authentication API Key (Get from Firebase Console > Project Settings)
const FIREBASE_AUTH_API_KEY = "AIzaSyA1jus20g4nU7lnHmJga7Fb9R0aF5AKNsk"; 

// Login API with Proper Email & Password Validation
app.post("/login", async (req, res) => {
  try {
      const { email, password } = req.body;
      if (!email || !password) {
          return res.status(400).json({ error: "Email and password are required." });
      }

      // Use Firebase REST API for password verification
      const firebaseAuthUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_AUTH_API_KEY}`;
      
      let firebaseResponse;
      try {
          firebaseResponse = await axios.post(firebaseAuthUrl, {
              email,
              password,
              returnSecureToken: true
          });
      } catch (error) {
          console.error("Firebase Auth Error:", error.response?.data || error.message);
          return res.status(401).json({ error: "Invalid email or password." });
      }

      // If authentication failed
      if (!firebaseResponse.data.idToken) {
          return res.status(401).json({ error: "Invalid password." });
      }

      // Get user details from Firebase Authentication
      const userRecord = await admin.auth().getUserByEmail(email);

      // 🔹 Fetch user details from Firestore using email instead of uid
      const userQuery = await db.collection("users").where("email", "==", email).limit(1).get();
      
      if (userQuery.empty) {
          return res.status(404).json({ error: "User not found in Firestore." });
      }

      // Get the first matching document
      const userData = userQuery.docs[0].data();

      return res.status(200).json({
          message: "Login successful",
          empId: userData.empId,
          name: userData.name,
          role: userData.role,
          subjects: userData.subjects
      });

  } catch (error) {
      console.error("Login Error:", error.response ? error.response.data : error.message);
      return res.status(500).json({ error: "Internal server error." });
  }
});

// Dashboard API - Get user data and assigned subjects
app.get("/dashboard/:empId", async (req, res) => {
  try {
    const { empId } = req.params;
    const { search, role } = req.query;

    if (!empId) {
      return res.status(400).json({ error: "Employee ID is required." });
    }

    // Get user data including profile picture
    const userDoc = await db.collection("users").doc(empId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found." });
    }

    const userData = userDoc.data();
    const userSubjects = userData.subjects || [];

    // Extract subject codes from the user's subjects list
    const subjectCodes = userSubjects.map(subject => subject.code);

    if (subjectCodes.length === 0) {
      return res.status(200).json({
        user: {
          empId: userData.empId,
          name: userData.name,
          email: userData.email,
          profile_picture: userData.profile_picture || "",
          role: userData.role,
          department: userData.department,
          phone: userData.phone,
          unreadNotifications: userData.unreadNotifications
        },
        subjects: []
      });
    }

    // Fetch all subjects assigned to the user
    const subjectSnapshots = await db.collection("subjects").where("code", "in", subjectCodes).get();

    if (subjectSnapshots.empty) {
      return res.status(200).json({
        user: {
          empId: userData.empId,
          name: userData.name,
          email: userData.email,
          profile_picture: userData.profile_picture || "",
          role: userData.role,
          department: userData.department,
          phone: userData.phone,
          unreadNotifications: userData.unreadNotifications
        },
        subjects: []
      });
    }

    // Process the subjects data
    let subjectsData = subjectSnapshots.docs.map(doc => {
      const subject = doc.data();

      // Ensure faculty is treated as an array
      const facultyList = Array.isArray(subject.faculty) ? subject.faculty : [];

      // Determine user's role in this subject
      let userRoleInSubject = "Faculty"; // Default role

      if (subject.courseCoordinator?.empId === empId) {
        userRoleInSubject = "Course Coordinator";
      } else if (subject.nbaCoordinator?.empId === empId) {
        userRoleInSubject = "NBA Coordinator";
      } else if (facultyList.some(f => f.empId === empId)) {
        userRoleInSubject = "Faculty";
      }

      return {
        code: subject.code,
        name: subject.name,
        courseCoordinator: subject.courseCoordinator || null,
        nbaCoordinator: subject.nbaCoordinator || null,
        userRole: userRoleInSubject
      };
    });

    // Apply search filter if provided
    if (search && search.trim() !== "") {
      const searchTerm = search.toLowerCase().trim();
      subjectsData = subjectsData.filter(subject =>
        subject.code.toLowerCase().includes(searchTerm) ||
        subject.name.toLowerCase().includes(searchTerm)
      );
    }

    // Filter by role if provided
    if (role && role.trim() !== "") {
      subjectsData = subjectsData.filter(subject =>
        subject.userRole.toLowerCase() === role.toLowerCase()
      );
    }

    return res.status(200).json({
      user: {
        empId: userData.empId,
        name: userData.name,
        email: userData.email,
        profile_picture: userData.profile_picture || "",
        role: userData.role,
        department: userData.department,
        phone: userData.phone,
        unreadNotifications: userData.unreadNotifications
      },
      subjects: subjectsData
    });

  } catch (error) {
    console.error("Dashboard API Error:", error);
    return res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// Profile API - Get user details
app.get("/profile/:empId", async (req, res) => {
  try {
    const { empId } = req.params;

    if (!empId) {
      return res.status(400).json({ error: "Employee ID is required." });
    }

    // Fetch user data
    const userDoc = await db.collection("users").doc(empId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found." });
    }

    const userData = userDoc.data();

    return res.status(200).json({
      empId: userData.empId,
      name: userData.name,
      email: userData.email,
      profile_picture: userData.profile_picture,
      department: userData.department,
      phone: userData.phone,
      unreadNotifications: userData.unreadNotifications
    });

  } catch (error) {
    console.error("Profile API Error:", error);
    return res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// Profile API - Update user details
app.put("/profile/:empId", async (req, res) => {
  try {
      const empId = req.params.empId;
      const { name, profile_picture, phone } = req.body;

      if (!name && !profile_picture && !phone) {
          return res.status(400).json({ error: "At least one field (name, profile_picture, phone) must be provided." });
      }

      const userRef = db.collection("users").doc(empId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
          return res.status(404).json({ error: "User not found." });
      }

      const oldName = userDoc.data().name; // Store old name for reference

      // Update user profile in Firestore
      let updateData = {};
      if (name) updateData.name = name;
      if (profile_picture) updateData.profile_picture = profile_picture;
      if (phone) updateData.phone = phone;

      await userRef.update(updateData);

      // If name is updated, update it across Firestore
      if (name) {
          const batch = db.batch();

          // Update name in `subjects` collection where user is Course/NBA Coordinator or Faculty
          const subjectsSnapshot = await db.collection("subjects").get();
          subjectsSnapshot.forEach((subjectDoc) => {
              const subjectData = subjectDoc.data();
              const subjectRef = subjectDoc.ref;
              let updated = false;

              // Update Course Coordinator
              if (subjectData.courseCoordinator && subjectData.courseCoordinator.empId === empId) {
                  subjectData.courseCoordinator.name = name;
                  updated = true;
              }

              // Update NBA Coordinator
              if (subjectData.nbaCoordinator && subjectData.nbaCoordinator.empId === empId) {
                  subjectData.nbaCoordinator.name = name;
                  updated = true;
              }

              // Update Faculty (if stored as an array)
              if (Array.isArray(subjectData.faculty)) {
                  subjectData.faculty.forEach((facultyMember) => {
                      if (facultyMember.empId === empId) {
                          facultyMember.name = name;
                          updated = true;
                      }
                  });
              }

              // Apply update if needed
              if (updated) batch.update(subjectRef, subjectData);
          });

          // Update name in `documentSlots` (uploaded_files and approvals)
          const documentSlotsSnapshot = await db.collection("documentSlots").get();
          documentSlotsSnapshot.forEach((slotDoc) => {
              const slotData = slotDoc.data();
              const slotRef = slotDoc.ref;
              let updated = false;

              // Fetch uploaded files inside document slots
              slotRef.collection("uploaded_files").get().then((uploadedFilesSnapshot) => {
                  uploadedFilesSnapshot.forEach((fileDoc) => {
                      const fileData = fileDoc.data();
                      let fileUpdated = false;

                      // Update uploader's name
                      if (fileData.uploadedBy && fileData.uploadedBy.empId === empId) {
                          fileData.uploadedBy.name = name;
                          fileUpdated = true;
                      }

                      // Update approvals inside uploaded files
                      if (fileData.approvals) {
                          fileData.approvals.forEach((approval) => {
                              if (approval.reviewedBy && approval.reviewedBy.empId === empId) {
                                  approval.reviewedBy.name = name;
                                  fileUpdated = true;
                              }
                          });
                      }

                      if (fileUpdated) batch.update(fileDoc.ref, fileData);
                  });
              });

              if (updated) batch.update(slotRef, slotData);
          });

          // Update name in `notifications` collection
          const notificationsSnapshot = await db.collection("notifications").where("recipient.empId", "==", empId).get();
          notificationsSnapshot.forEach((notifDoc) => {
              batch.update(notifDoc.ref, { "recipient.name": name });
          });

          // Commit batch update
          await batch.commit();
      }

      return res.status(200).json({ message: "Profile updated successfully." });
  } catch (error) {
      console.error("Error updating profile:", error);
      return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
});

// Subject Details Faculty API - Fetch Subject Details for Faculty
app.get("/subject-details/:empId/:subjectCode", async (req, res) => {
  try {
    const { empId, subjectCode } = req.params;

    if (!empId || !subjectCode) {
      return res.status(400).json({ error: "Employee ID and Subject Code are required." });
    }

    // Fetch the user's data
    const userDoc = await db.collection("users").doc(empId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found." });
    }
    const userData = userDoc.data();

    // Fetch the subject details
    const subjectDoc = await db.collection("subjects").doc(subjectCode).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({ error: "Subject not found." });
    }
    const subjectData = subjectDoc.data();

    // Handle different faculty data structures
    let isFacultyAssigned = false;
    if (Array.isArray(subjectData.faculty)) {
      isFacultyAssigned = subjectData.faculty.some(faculty => faculty.empId === empId);
    } else if (typeof subjectData.faculty === 'object' && subjectData.faculty !== null) {
      isFacultyAssigned = Object.values(subjectData.faculty).some(faculty => faculty.empId === empId);
    }

    if (!isFacultyAssigned) {
      return res.status(403).json({ error: "You are not assigned as a faculty for this subject." });
    }

    // Retrieve Course and NBA Coordinators with default values
    const courseCoordinator = {
      empId: subjectData.courseCoordinator?.empId || '',
      name: subjectData.courseCoordinator?.name || ''
    };
    
    const nbaCoordinator = {
      empId: subjectData.nbaCoordinator?.empId || '',
      name: subjectData.nbaCoordinator?.name || ''
    };

    // Retrieve document slots
    const documentSlots = [];
    const slotsSnapshot = await db.collection("subjects")
      .doc(subjectCode)
      .collection("documentSlots")
      .orderBy("deadline", "asc")
      .get();

    // Process each slot
    for (const slotDoc of slotsSnapshot.docs) {
      try {
        const slotData = slotDoc.data();
        
        // Get uploaded files for this slot
        const filesSnapshot = await slotDoc.ref.collection("uploaded_files")
          .orderBy("uploadTime", "desc")
          .get();
        const files = [];

        // Process each file
        for (const fileDoc of filesSnapshot.docs) {
          const fileData = fileDoc.data();
          
          // Determine file permissions
          const isUploader = fileData.uploadedBy?.empId === empId;
          const isCourseCoordinatorFile = fileData.uploadedBy?.empId === courseCoordinator.empId;
          
          // Get download URL for the file
          let downloadUrl = '';
          try {
            const fileRef = admin.storage().bucket().file(fileData.storageUrl);
            [downloadUrl] = await fileRef.getSignedUrl({
              action: 'read',
              expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
            });
          } catch (error) {
            console.error(`Error getting download URL for file ${fileDoc.id}:`, error);
          }

          // Add file to the list if user has access
          if (isUploader || isCourseCoordinatorFile) {
            files.push({
              id: fileDoc.id,
              fileName: fileData.fileName || '',
              fileSize: fileData.fileSize || 0,
              fileType: fileData.fileType || '',
              uploadTime: fileData.uploadTime || null,
              uploadedBy: fileData.uploadedBy || {},
              downloadUrl,
              reviews: fileData.reviews || [],
              status: fileData.status || 'pending',
              canDelete: isUploader && fileData.status === 'pending',
              canView: true,
              isCoordinatorFile: isCourseCoordinatorFile
            });
          }
        }

        // Add slot with its files
        documentSlots.push({
            slotId: slotDoc.id,
            title: slotData.title || slotData.name || '',  // Try both title and name
            name: slotData.title || slotData.name || '',   // For backwards compatibility
            deadline: slotData.deadline ? slotData.deadline.toDate() : null,  // Convert Firestore timestamp
            description: slotData.description || '',
            files: files
        });
      } catch (error) {
        console.error(`Error processing slot ${slotDoc.id}:`, error);
        continue;
      }
    }

    // Prepare the response
    const response = {
      subject: {
        code: subjectData.code || '',
        name: subjectData.name || '',
        courseCoordinator,
        nbaCoordinator,
        documentSlots
      },
      faculty: {
        empId: userData.empId || '',
        name: userData.name || '',
        profile_picture: userData.profile_picture || '',
        department: userData.department || '',
        role: userData.role || []
      }
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error("Subject Details API Error:", error);
    return res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// Document Upload API
app.post("/subject-details/:empId/:subjectCode/:slotId/upload", upload.single('file'), async (req, res) => {
  try {
    const { empId, subjectCode, slotId } = req.params;
    const file = req.file;

    // Validate inputs
    if (!empId || !subjectCode || !slotId || !file) {
      return res.status(400).json({ error: "All fields are required." });
    }

    // Verify user's access
    const subjectDoc = await db.collection("subjects").doc(subjectCode).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({ error: "Subject not found." });
    }

    const subjectData = subjectDoc.data();
    const isFacultyAssigned = Array.isArray(subjectData.faculty) && 
                            subjectData.faculty.some(f => f.empId === empId);

    if (!isFacultyAssigned) {
      return res.status(403).json({ error: "Not authorized." });
    }

    // Check if slot exists
    const slotDoc = await db.collection("subjects")
      .doc(subjectCode)
      .collection("documentSlots")
      .doc(slotId)
      .get();

    if (!slotDoc.exists) {
      return res.status(404).json({ error: "Document slot not found." });
    }

    // Check if deadline has passed
    const slotData = slotDoc.data();
    if (slotData.deadline && new Date(slotData.deadline) < new Date()) {
      return res.status(400).json({ error: "Deadline has passed for this slot." });
    }

    // Upload file to Firebase Storage
    const fileName = `${Date.now()}_${file.originalname}`;
    const filePath = `documents/${subjectCode}/${slotId}/${fileName}`;
    const fileRef = admin.storage().bucket().file(filePath);
    
    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype
      }
    });

    // Get download URL
    const [downloadUrl] = await fileRef.getSignedUrl({
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    });

    // Save file metadata to Firestore
    const uploadedFileRef = await db.collection("subjects")
      .doc(subjectCode)
      .collection("documentSlots")
      .doc(slotId)
      .collection("uploaded_files")
      .add({
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        uploadTime: admin.firestore.FieldValue.serverTimestamp(),
        uploadedBy: {
          empId,
          name: subjectData.faculty.find(f => f.empId === empId)?.name || "Unknown"
        },
        storageUrl: filePath,
        downloadUrl,
        reviews: [],
        status: "pending"
      });

    return res.status(200).json({
      message: "File uploaded successfully",
      fileId: uploadedFileRef.id,
      downloadUrl
    });

  } catch (error) {
    console.error("Upload Error:", error);
    return res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// Document Delete API
app.delete("/subject-details/:empId/:subjectCode/:slotId/:fileId", async (req, res) => {
  try {
    const { empId, subjectCode, slotId, fileId } = req.params;

    // Fetch file details
    const fileDoc = await db.collection("subjects")
      .doc(subjectCode)
      .collection("documentSlots")
      .doc(slotId)
      .collection("uploaded_files")
      .doc(fileId)
      .get();

    if (!fileDoc.exists) {
      return res.status(404).json({ error: "File not found." });
    }

    const fileData = fileDoc.data();

    // Check if user is authorized to delete
    if (fileData.uploadedBy.empId !== empId) {
      return res.status(403).json({ error: "Not authorized to delete this file." });
    }

    // Check if file status allows deletion
    if (fileData.status !== 'pending') {
      return res.status(403).json({ error: "Cannot delete file after review process has started." });
    }

    // Delete from Storage
    try {
      const fileRef = admin.storage().bucket().file(fileData.storageUrl);
      await fileRef.delete();
    } catch (error) {
      console.error("Error deleting file from storage:", error);
      // Continue with Firestore deletion even if storage deletion fails
    }

    // Delete from Firestore
    await fileDoc.ref.delete();

    return res.status(200).json({ message: "File deleted successfully" });

  } catch (error) {
    console.error("Delete Error:", error);
    return res.status(500).json({ error: "Internal server error: " + error.message });
  }
});



// Export API
exports.api = functions.https.onRequest(app);
