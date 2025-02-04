// Made by @martijara
// Edited by @neonpegasu5

// Importing necessary libraries
import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Pango from 'gi://Pango';
import {convertMD} from "./md2pango.js";

import * as Main from 'resource:///org/gnome/shell/ui/main.js';


// Defining necessary variables (Anthropic API)
let ANTHROPIC_API_KEY = "";
let ANTHROPIC_MODEL = ""; 
let HISTORY = [];
let BACKGROUND_COLOR_HUMAN_MESSAGE = "";
let BACKGROUND_COLOR_LLM_MESSAGE = "";
let COLOR_HUMAN_MESSAGE = "";
let COLOR_LLM_MESSAGE = ""
let url = `https://api.anthropic.com/v1/messages`;



// Class that activates the extension
const Penguin = GObject.registerClass(
class Penguin extends PanelMenu.Button 
{
    
    
    _loadSettings () {
        this._settingsChangedId = this.extension.settings.connect('changed', () => {
            this._fetchSettings();
        });
        this._fetchSettings();
    }

    _fetchSettings () {
        const { settings } = this.extension;
        ANTHROPIC_API_KEY = settings.get_string("open-router-api-key");
        ANTHROPIC_MODEL = settings.get_string("llm-model");

        BACKGROUND_COLOR_HUMAN_MESSAGE = settings.get_string("human-message-color");
        BACKGROUND_COLOR_LLM_MESSAGE = settings.get_string("llm-message-color");

        COLOR_HUMAN_MESSAGE = settings.get_string("human-message-text-color");
        COLOR_LLM_MESSAGE = settings.get_string("llm-message-text-color");

        HISTORY = JSON.parse(settings.get_string("history"));
    }

    _init(extension) {
        // --- INITIALIZATION AND ICON IN TOPBAR
        super._init(0.0, _('Penguin: AI Chatbot'));
        this.extension = extension
        this._loadSettings();

        this.add_child(new St.Icon({
            icon_name: 'Penguin: AI Chatbot',
            style_class: 'icon',
        }));


        // ... INITIALIZATION OF SESSION VARIABLES
        this.history = []
        this._httpSession = new Soup.Session();
        this.timeoutCopy = null
        this.timeoutResponse = null


        // --- EXTENSION FOOTER
        this.chatInput = new St.Entry({
            hint_text: "Chat with me",
            can_focus: true,
            track_hover: true,
            style_class: 'messageInput'
        });

        // Enter clicked
        this.chatInput.clutter_text.connect('activate', (actor) => {
            if (this.timeoutResponse) {
                GLib.Source.remove(this.timeoutResponse);
                this.timeoutResponse = null;
            }

            let input = this.chatInput.get_text();

            
            this.initializeTextBox('humanMessage', input, BACKGROUND_COLOR_HUMAN_MESSAGE, COLOR_HUMAN_MESSAGE)

            // Add input to chat history
            this.history.push({
                "role": "user",
                "content": input
            });

            this.openRouterChat();

            this.chatInput.set_reactive(false)
            this.chatInput.set_text("I am Thinking...")
        });

        this.newConversation = new St.Button({ 
            style: "width: 16px; height:16px; margin-right: 15px; margin-left: 10px'",
        
            child: new St.Icon({
                icon_name: 'tab-new-symbolic',
                style: 'width: 30px; height:30px'}) 
        });

        this.newConversation.connect('clicked', (actor) => {
            if (this.chatInput.get_text() == "Create a new conversation (Deletes current)" ||  this.chatInput.get_text() != "I am Thinking...") {
                this.history = []

                const { settings } = this.extension;
                settings.set_string("history", "[]");

                this.chatBox.destroy_all_children()
            }
            else {

                this.initializeTextBox('llmMessage', "You can't create a new conversation while I am thinking", BACKGROUND_COLOR_LLM_MESSAGE, COLOR_LLM_MESSAGE);
            }
        });

        this.newConversation.connect('enter-event', (actor) => {
            if (this.chatInput.get_text() == "") {
                this.chatInput.set_reactive(false)
                this.chatInput.set_text("Create a new conversation (Deletes current)")
            }
        });

        this.newConversation.connect('leave-event', (actor) => {
            if (this.chatInput.get_text() == "Create a new conversation (Deletes current)") {
                this.chatInput.set_reactive(true)
                this.chatInput.set_text("")
            }
        });


        let entryBox = new St.BoxLayout({
            vertical: false,
            style_class: 'popup-menu-box'
        });

        entryBox.add_child(this.chatInput);
        entryBox.add_child(this.newConversation);




        // --- EXTENSION BODY
        this.chatBox = new St.BoxLayout({
            vertical: true,
            style_class: 'popup-menu-box',
            style: 'text-wrap: wrap'
        });

        this.chatInput.set_reactive(false)
        this.chatInput.set_text("Loading history...")
        this._loadHistory();

        this.chatView = new St.ScrollView({
            enable_mouse_scrolling: true,
            style_class: 'chat-scrolling',
            reactive: true
        });

        this.chatView.set_child(this.chatBox);


        // tab-new-symbolic
        

        // --- EXTENSION PARENT BOX LAYOUT

        let layout = new St.BoxLayout({
            vertical: true,
            style_class: 'popup-menu-box'
        });

        layout.add_child(this.chatView);
        layout.add_child(entryBox);

        
        // --- ADDING EVERYTHING TOGETHER TO APPEAR AS A POP UP MENU
        let popUp = new PopupMenu.PopupMenuSection();
        popUp.actor.add_child(layout);

        this.menu.addMenuItem(popUp);

        
    };

    _loadHistory() {
        this.history = HISTORY

        this.history.forEach(json => {
            if (json.role == "user") {
                this.initializeTextBox("humanMessage", convertMD(json.content), BACKGROUND_COLOR_HUMAN_MESSAGE, COLOR_HUMAN_MESSAGE);
            }
            else {
                this.initializeTextBox("llmMessage", convertMD(json.content), BACKGROUND_COLOR_LLM_MESSAGE, COLOR_LLM_MESSAGE);
            }
        });

        this.chatInput.set_reactive(true)
        this.chatInput.set_text("")

        return;
    }

    
    openRouterChat() {
        let message = Soup.Message.new('POST', url);
        
        message.request_headers.append(
            'x-api-key',
            ANTHROPIC_API_KEY
        );
        message.request_headers.append(
            'anthropic-version',
            '2023-06-01'
        );
        message.request_headers.append(
            'content-type',
            'application/json'
        );

        // Convert history format to Anthropic format
        let anthropicMessages = this.history.map(msg => ({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.content
        }));

        let body = JSON.stringify({
            "model": ANTHROPIC_MODEL,
            "messages": anthropicMessages,
            "max_tokens": 1024
        });
        let bytes = GLib.Bytes.new(body);

        message.set_request_body_from_bytes('application/json', bytes);

        this._httpSession.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    if (message.get_status() === Soup.Status.OK) {
                        const bytes = session.send_and_read_finish(result);
                        const decoder = new TextDecoder('utf-8');
                        const response = JSON.parse(decoder.decode(bytes.get_data()));
                        
                        const assistantMessage = response.content[0].text;
                        this.history.push({
                            "role": "assistant",
                            "content": assistantMessage
                        });

                        this.initializeTextBox('llmMessage', convertMD(assistantMessage), BACKGROUND_COLOR_LLM_MESSAGE, COLOR_LLM_MESSAGE);
                        
                        // Save updated history
                        const { settings } = this.extension;
                        settings.set_string("history", JSON.stringify(this.history));
                    } else {
                        let errorMessage = "Sorry, I encountered an error. Please check your API key and try again.";
                        this.initializeTextBox('llmMessage', errorMessage, BACKGROUND_COLOR_LLM_MESSAGE, COLOR_LLM_MESSAGE);
                    }
                } catch (error) {
                    let errorMessage = "An error occurred while processing the response.";
                    this.initializeTextBox('llmMessage', errorMessage, BACKGROUND_COLOR_LLM_MESSAGE, COLOR_LLM_MESSAGE);
                    logError(error);
                }

                this.chatInput.set_reactive(true);
                this.chatInput.set_text("");
            }
        );

        return;
    }

    initializeTextBox(type, text, color, textColor) {
        let box = new St.BoxLayout({
            vertical: true,
            style_class: `${type}-box`
        });
        
        // text has to be a string
        let label = new St.Label({
            style_class: type,
            style: `background-color: ${color}; color: ${textColor}`,
            y_expand: true,
            reactive: true
        });

        label.clutter_text.single_line_mode = false;
        label.clutter_text.line_wrap        = true;
        label.clutter_text.line_wrap_mode   = Pango.WrapMode.WORD_CHAR;
        label.clutter_text.ellipsize        = Pango.EllipsizeMode.NONE;

        box.add_child(label)

        if(type != 'humanMessage') {
            label.connect('button-press-event', (actor) => {
                this.extension.clipboard.set_text(St.ClipboardType.CLIPBOARD, label.clutter_text.get_text());
            });
            
            

            label.connect('enter-event', (actor) => {

                
                if (this.chatInput.get_text() == "") {
                    this.timeoutCopy = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 0.4, () => { 
                        this.chatInput.set_reactive(false);
                        this.chatInput.set_text("Click on text to copy");});
                }
            });

            label.connect('leave-event', (actor) => {
                if (this.timeoutCopy) {
                    GLib.Source.remove(this.timeoutCopy);
                    this.timeoutCopy = null;
                }

                if (this.chatInput.get_text() == "Click on text to copy") {
                    this.chatInput.set_reactive(true);
                    this.chatInput.set_text("");
                }
            });
            
        } 

        label.clutter_text.set_markup(text);
        this.chatBox.add_child(box);
    }

    openSettings () {
        this.extension.openSettings();
    }

    destroy() {
        if (this.timeoutCopy) {
            GLib.Source.remove(this.timeoutCopy);
            this.timeoutCopy = null;
        }

        if (this.timeoutResponse) {
            GLib.Source.remove(this.timeoutResponse);
            this.timeoutResponse = null;
        }

        this._httpSession?.abort(); // <- Don't forget to make the session instance avaialable to the class
        HISTORY = null;
        super.destroy();
    }
    
});


export default class PenguinExtension extends Extension {
    enable() {
        this._penguin = new Penguin({
            settings: this.getSettings(),
            clipboard: St.Clipboard.get_default(),
            openSettings: this.openPreferences,
            uuid: this.uuid
        });

        Main.panel.addToStatusArea(this.uuid, this._penguin);
    }
    disable() {
        this._penguin.destroy();
        this._penguin = null;
    }
}


