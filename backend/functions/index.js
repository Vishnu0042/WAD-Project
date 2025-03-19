const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

admin.initializeApp();
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

////////////////////////////////////////DASHBOARD

app.post("/get-user-dashboard", async (req, res) => {
    try {
        const { empId } = req.body;
        if (!empId) {
            return res.status(400).json({ error: "Employee ID is required." });
        }

        // Fetch user data from Firestore
        const userDoc = await db.collection("users").doc(empId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: "User not found." });
        }
        const userData = userDoc.data();

        // Fetch subjects assigned to the user
        const subjects = [];
        for (const subj of userData.subjects) {
            const subjectDoc = await db.collection("subjects").doc(subj.code).get();
            if (subjectDoc.exists) {
                const subjectData = subjectDoc.data();
                subjects.push({
                    name: subjectData.name,
                    code: subjectData.code,
                    courseCoordinator: subjectData.courseCoordinator || { name: "Not Assigned" },
                    nbaCoordinator: subjectData.nbaCoordinator || { name: "Not Assigned" },
                    role: userData.role // User's role in this subject
                });
            }
        }

        return res.status(200).json({
            profile_picture: userData.profile_picture || "", // Default to empty if not set
            subjects: subjects
        });

    } catch (error) {
        console.error("Error fetching user dashboard:", error.message);
        return res.status(500).json({ error: "Internal server error." });
    }
});

// Export API
exports.api = functions.https.onRequest(app);
