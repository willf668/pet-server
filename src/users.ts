import { Response } from 'express';
import fs from 'fs';
import uuid4 from 'uuid4';
import bcrypt from 'bcrypt';

import { User } from '../types/userTypes';
import { sendMail } from './email';

interface UserMap {
    [key: string]: User;
}

const saveJSON = (data: object, fileName: string, checkDir = true) => {
    if (checkDir && !fs.existsSync('./saveData')) fs.mkdirSync('./saveData');
    fs.writeFile(fileName, JSON.stringify(data), (err) => {
        if (err) throw err;
    });
};
const loadJSON = (fileName: string, defaultData = {}) => {
    if (!fs.existsSync('./saveData')) fs.mkdirSync('./saveData');
    if (!fs.existsSync(fileName)) {
        saveJSON(defaultData, fileName, false);
        return defaultData;
    }
    return JSON.parse(fs.readFileSync(fileName).toString()) || {};
};

const hashPassword = async (password: string) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
};

let users: UserMap = loadJSON('./saveData/users.json');
let userSessions: { [key: string]: string } = loadJSON(
    './saveData/userSessions.json'
);
let userAuthCodes: {
    [key: string]: {
        code: number;
        passwordHash: string;
    };
} = {};

export const resetUsers = async () => {
    if (fs.existsSync('saveData'))
        fs.rmdirSync('saveData', { recursive: true });
    users = {};
    userSessions = {};
    userAuthCodes = {};
};

export const getUser = (session: string): User | null => {
    const email = userSessions[session];
    if (!email || !(email in users)) return null;
    return users[email];
};

export const updateUser = (user: Partial<User>) => {
    const { email } = user;
    if (!email) return;
    users[email] = { ...users[email], ...user };
    saveJSON(users, './saveData/users.json');
};

export const signup = async (
    email: string,
    password: string,
    res: Response
) => {
    const user = getUser(email);
    if (user) {
        return res.status(201).send({ error: 'User already exists' });
    }

    const code = Math.floor(100000 + Math.random() * 900000);
    userAuthCodes[email] = {
        code,
        passwordHash: await hashPassword(password),
    };

    sendMail({
        to: email,
        from: 'old dude',
        subject: 'Pet-Server: Signup',
        text: `
            Welcome to Pet-Server!
            Please enter the following code to complete your signup:
            ${code}
        `,
    });

    return res.send({ sessionToken: 'waiting' });
};

export const signupCode = async (
    email: string,
    code: number,
    res: Response
) => {
    const userAuth = userAuthCodes[email];
    if (!userAuth) {
        return res.status(404).send({ error: 'User does not exist' });
    }
    if (userAuth.code !== code) {
        return res.status(401).send({ error: 'Invalid code' });
    }

    const sessionToken = uuid4();
    userSessions[sessionToken] = email;
    const newUser = {} as User;
    newUser.email = email;
    newUser.sessionToken = sessionToken;
    updateUser(newUser);
    res.send({ sessionToken: sessionToken });

    saveJSON(userSessions, './saveData/userSessions.json');
};

export const login = async (email: string, password: string, res: Response) => {
    const hash = await hashPassword(password);
    const user = getUser(email);
    if (!user)
        return res.status(404).send({
            error: 'No user found',
        });
    if (user.passwordHash !== hash)
        return res.status(401).send({
            error: 'Incorrect password',
        });

    const newSession = uuid4();
    userSessions[email] = newSession;
    user.sessionToken = newSession;

    return res.send({ sessionToken: newSession });
};

export const logout = (session: string, res: Response) => {
    if (!(session in userSessions))
        return res.status(401).send({
            error: 'Invalid session',
        });

    delete userSessions[session];

    return res.send({
        result: 'ok',
    });
};
