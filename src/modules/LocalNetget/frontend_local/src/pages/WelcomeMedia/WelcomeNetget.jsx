import './css/styles.css';

const WelcomeNetget = () => {
    return (
        <div className="welcome-page">
            {/* Removed video background */}
            <div className="overlay"></div>
            <div className="modal">
                <img src="/media/neurons-grey.png" alt="neurons" width="89" />
                <h2><strong>Local NetGet</strong></h2>
                <div className="buttons">
                <a href="/home" className="btn">Enter</a>
                </div>
            </div>
        </div>
    );
};

export default WelcomeNetget;