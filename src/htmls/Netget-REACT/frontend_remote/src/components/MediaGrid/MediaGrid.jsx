import React, { useState } from 'react';
import mediaData from '../../assets/media.json';

const MediaGrid = () => {
    const [expandedItem, setExpandedItem] = useState(null);

    const toggleEmails = (key) => {
        setExpandedItem((prevKey) => (prevKey === key ? null : key));
    };

    return (
        <div className="welcome-grid">
            {Object.entries(mediaData.medias).map(([key, value]) => (
                <div key={key} className="welcome-card">
                    <h3>{key}</h3>
                    <ul>
                        {Object.entries(value).map(([platform, links]) => (
                            platform !== "Emails" && links && (
                                <li key={platform}>
                                    <strong>{platform}: </strong>
                                    {Array.isArray(links) ? (
                                        links.map((link, index) => (
                                            <a key={index} href={link} target="_blank" rel="noopener noreferrer">
                                                {link}
                                            </a>
                                        ))
                                    ) : (
                                        <a href={links} target="_blank" rel="noopener noreferrer">
                                            {links}
                                        </a>
                                    )}
                                </li>
                            )
                        ))}
                    </ul>
                    {value.Emails?.length > 0 && (
                        <div>
                            <button className="welcome-btn" onClick={() => toggleEmails(key)}>
                                {expandedItem === key ? "Hide Emails" : "Show Emails"}
                            </button>
                            {expandedItem === key && (
                                <ul className="welcome-emails">
                                    {value.Emails.map((email, index) => (
                                        <li key={index}>{email}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

export default MediaGrid;