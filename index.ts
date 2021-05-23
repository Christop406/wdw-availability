import axios from 'axios';
import fs = require('fs');
import nodemailer = require('nodemailer');
import path = require('path');
import config = require('./config.json');

const Parks: Record<string, string> = {
    '80007838': 'Epcot',
    '80007823': 'Animal Kingdom',
    '80007944': 'Magic Kingdom',
    '80007998': 'Hollywood Studios',
    '00000000': 'Test Park',
};

interface Availability {
    date: string;
    availability: string;
    parks: string[];
}
type AvailabilityResponse = Availability[];

const makeDateMap = (availability: AvailabilityResponse): Record<string, Availability> => {
    let map: Record<string, Availability> = {};

    availability.forEach((av) => {
        map[av.date] = av;
    });

    return map;
};

const diffDateMap = (oldMap: Record<string, Availability>, newMap: Record<string, Availability>): Availability[] => {
    const availability: Availability[] = [];
    Object.keys(oldMap).forEach((oldKey) => {
        const dateAvailability: Availability = {
            date: oldKey,
            availability: 'partial',
            parks: [],
        };

        const oldAv = oldMap[oldKey];
        const newAv = newMap[oldKey];

        const parkSet = new Set<string>();
        oldAv.parks.forEach((park) => {
            parkSet.add(park);
        });

        newAv.parks?.forEach((park) => {
            if (parkSet.has(park)) {
                parkSet.delete(park);
            } else {
                dateAvailability.parks.push(`+${park}`);
            }
        });

        Array.from(parkSet.keys()).forEach((k) => {
            dateAvailability.parks.push(`-${k}`);
        });

        if (dateAvailability.parks.length > 0) {
            availability.push(dateAvailability);
        }
    });

    return availability;
}

const buildDiffString = (diff: Availability[]): string => {
    let diffString = '';

    diff.forEach((av) => {
        diffString += `${av.date}:\n`;
        const addedParks = av.parks.filter((p) => p.startsWith('+')).map((p) => Parks[p.substr(1)]);
        const removedParks = av.parks.filter((p) => p.startsWith('-')).map((p) => Parks[p.substr(1)]);

        if (addedParks.length) {
            diffString += '  Added:\n';
            addedParks.forEach((park) => {
                diffString += `    + ${park}\n`;
            });
        }

        if (removedParks.length) {
            diffString += '  Removed:\n';
            removedParks.forEach((park) => {
                diffString += `    - ${park}\n`;
            });
        }

    });

    return diffString;
};

const sendNotification = async (body: string) => {
    const transport = nodemailer.createTransport({
        host: config.sendConfig.host,
        secure: true,
        auth: {
            user: config.sendConfig.user,
            pass: config.sendConfig.password
        },
    });

    await transport.sendMail({
        from: `"${config.sendConfig.name}" <${config.sendConfig.user}>`,
        to: config.sendConfig.to,
        cc: config.sendConfig.cc,
        subject: 'WDW Availability Change',
        text: body
    })
};

const checkAvailability = async (start: string, end: string, filePath: string) => {
    const response = await axios.get<AvailabilityResponse>(`https://disneyworld.disney.go.com/availability-calendar/api/calendar?segment=tickets&startDate=${start}&endDate=${end}`);
    // console.log(response.data);
    if (Array.isArray(response.data)) {

        const resultMap = makeDateMap(response.data);

        if (fs.existsSync(filePath)) {
            const oldAvailabilityMap: Record<string, Availability> = JSON.parse(fs.readFileSync(filePath).toString('utf-8'));
            const diff = diffDateMap(oldAvailabilityMap, resultMap);
            if (diff.length > 0) {
                const diffString = buildDiffString(diff);
                await sendNotification(diffString);
            }
        }

        fs.writeFileSync(filePath, JSON.stringify(resultMap));

        console.log('Availability');
        response.data.forEach((date) => {
            console.log(`${date.date}: ${date.parks.map((p) => Parks[p]).join(', ')}`);
        });
    }
};

const directory = path.join(process.cwd(), 'data');
const filePath = path.join(directory, config.output.filename || 'availability.json');

if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
}

checkAvailability(config.dateRange.start, config.dateRange.end, filePath);